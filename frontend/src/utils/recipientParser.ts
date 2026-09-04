export interface ParseResult {
  valid: string[];
  invalid: string[];
  duplicates: string[];
  totalRead: number;
}

export interface ParseOptions {
  maxFileSizeMB?: number;
}

export interface ParseTextOptions {
  isCsv?: boolean;
}

export const MAX_FILE_SIZE_MB = 5;

// Recognized CSV header names (matched case-insensitively and whitespace-tolerantly)
const RECOGNIZED_CSV_HEADERS = new Set([
  'email',
  'email address',
  'email_address',
  'recipient',
  'recipient email',
  'recipient_email'
]);

/**
 * Checks if a string matches any recognized CSV column header.
 */
export const isRecognizedCsvHeader = (text: string): boolean => {
  if (!text) return false;
  const clean = text.replace(/^["']|["']$/g, '').trim().toLowerCase();
  return RECOGNIZED_CSV_HEADERS.has(clean);
};

// Standard RFC-compliant email validation regex
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

/**
 * Validates whether a given string is a valid email format.
 */
export const isValidEmail = (email: string): boolean => {
  if (!email || email.length > 254) return false;
  return EMAIL_REGEX.test(email);
};

/**
 * Extracts and parses email addresses from raw text content (CSV or TXT).
 * Trims whitespace, validates format, deduplicates case-insensitively,
 * and ignores recognized first-row headers when parsing CSV format.
 */
export const parseRecipientText = (
  content: string, 
  options?: ParseTextOptions
): ParseResult => {
  const isCsv = options?.isCsv ?? false;
  const result: ParseResult = {
    valid: [],
    invalid: [],
    duplicates: [],
    totalRead: 0
  };

  if (!content || !content.trim()) {
    return result;
  }

  const seenSet = new Set<string>();

  // Split by line breaks
  const lines = content.split(/\r\n|\r|\n/);
  let isFirstNonEmptyLine = true;

  for (const rawLine of lines) {
    const trimmedLine = rawLine.trim();
    if (!trimmedLine) continue;

    const isFirstRow = isFirstNonEmptyLine;
    isFirstNonEmptyLine = false;

    // Split line by commas, semicolons, or tabs
    const cells = trimmedLine.split(/[,;\t]+/);

    for (let rawCell of cells) {
      let cell = rawCell.trim();
      if (!cell) continue;

      // Handle quoted cells like "test@example.com" or "Email Address"
      cell = cell.replace(/^["']|["']$/g, '').trim();

      // If parsing CSV and this is the first non-empty row, ignore recognized header
      if (isCsv && isFirstRow && isRecognizedCsvHeader(cell)) {
        continue;
      }

      // Handle angle bracket format like "John Doe <john@example.com>"
      const bracketMatch = cell.match(/<([^>]+)>/);
      if (bracketMatch && bracketMatch[1]) {
        cell = bracketMatch[1].trim();
      }

      if (!cell) continue;

      result.totalRead++;

      if (isValidEmail(cell)) {
        const normalized = cell.toLowerCase();
        if (seenSet.has(normalized)) {
          result.duplicates.push(cell);
        } else {
          seenSet.add(normalized);
          result.valid.push(normalized);
        }
      } else {
        result.invalid.push(cell);
      }
    }
  }

  return result;
};

/**
 * Reads and parses a recipient file (.csv or .txt).
 * Validates file extension and size before parsing.
 */
export const parseRecipientFile = async (
  file: File,
  options?: ParseOptions
): Promise<ParseResult> => {
  const maxMB = options?.maxFileSizeMB || MAX_FILE_SIZE_MB;
  const maxBytes = maxMB * 1024 * 1024;

  if (file.size > maxBytes) {
    throw new Error(`File size (${(file.size / (1024 * 1024)).toFixed(2)} MB) exceeds the ${maxMB} MB limit.`);
  }

  const fileName = file.name.toLowerCase();
  const isCsv = fileName.endsWith('.csv') || file.type === 'text/csv';
  const isTxt = fileName.endsWith('.txt') || file.type === 'text/plain';

  if (!isCsv && !isTxt) {
    throw new Error('Unsupported file format. Please upload a .csv or .txt file.');
  }

  const text = await file.text();
  return parseRecipientText(text, { isCsv });
};
