import { describe, it, expect } from 'vitest';
import { 
  parseRecipientText, 
  parseRecipientFile, 
  isValidEmail,
  isRecognizedCsvHeader,
  MAX_FILE_SIZE_MB
} from './recipientParser';

describe('isValidEmail', () => {
  it('should validate valid email addresses', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
    expect(isValidEmail('first.last@domain.co.uk')).toBe(true);
    expect(isValidEmail('user+tag@gmail.com')).toBe(true);
    expect(isValidEmail('reachinbox_tester123@sub.domain.org')).toBe(true);
  });

  it('should invalidate incorrect email strings', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('plainaddress')).toBe(false);
    expect(isValidEmail('@missingusername.com')).toBe(false);
    expect(isValidEmail('username@.com')).toBe(false);
    expect(isValidEmail('username@domain')).toBe(false);
    expect(isValidEmail('user name@domain.com')).toBe(false);
  });
});

describe('isRecognizedCsvHeader', () => {
  it('should recognize all specified CSV header variations case-insensitively with whitespace and quotes', () => {
    expect(isRecognizedCsvHeader('email')).toBe(true);
    expect(isRecognizedCsvHeader('EMAIL')).toBe(true);
    expect(isRecognizedCsvHeader('  Email  ')).toBe(true);
    expect(isRecognizedCsvHeader('"email"')).toBe(true);
    expect(isRecognizedCsvHeader('email address')).toBe(true);
    expect(isRecognizedCsvHeader('Email Address')).toBe(true);
    expect(isRecognizedCsvHeader('email_address')).toBe(true);
    expect(isRecognizedCsvHeader('EMAIL_ADDRESS')).toBe(true);
    expect(isRecognizedCsvHeader('recipient')).toBe(true);
    expect(isRecognizedCsvHeader('Recipient')).toBe(true);
    expect(isRecognizedCsvHeader('recipient email')).toBe(true);
    expect(isRecognizedCsvHeader('Recipient Email')).toBe(true);
    expect(isRecognizedCsvHeader('recipient_email')).toBe(true);
    expect(isRecognizedCsvHeader('RECIPIENT_EMAIL')).toBe(true);
    expect(isRecognizedCsvHeader('"  recipient_email  "')).toBe(true);
  });

  it('should return false for non-header strings or valid emails', () => {
    expect(isRecognizedCsvHeader('user@example.com')).toBe(false);
    expect(isRecognizedCsvHeader('phone_number')).toBe(false);
    expect(isRecognizedCsvHeader('')).toBe(false);
    expect(isRecognizedCsvHeader('first_name')).toBe(false);
  });
});

describe('parseRecipientText', () => {
  it('should parse simple TXT format with one email per line', () => {
    const text = `
      alice@example.com
      bob@example.com
      charlie@example.com
    `;
    const result = parseRecipientText(text);

    expect(result.valid).toEqual([
      'alice@example.com',
      'bob@example.com',
      'charlie@example.com'
    ]);
    expect(result.invalid).toHaveLength(0);
    expect(result.duplicates).toHaveLength(0);
    expect(result.totalRead).toBe(3);
  });

  it('should parse CSV format with commas, quotes, and whitespace', () => {
    const csv = `
      "john@company.com", "sarah@startup.io", alex@domain.org
      "Jane Doe <jane@company.com>", mike@agency.net
    `;
    const result = parseRecipientText(csv, { isCsv: true });

    expect(result.valid).toEqual([
      'john@company.com',
      'sarah@startup.io',
      'alex@domain.org',
      'jane@company.com',
      'mike@agency.net'
    ]);
    expect(result.invalid).toHaveLength(0);
    expect(result.duplicates).toHaveLength(0);
    expect(result.totalRead).toBe(5);
  });

  it('should detect invalid email addresses in mixed CSV/TXT', () => {
    const content = `
      valid.email@example.com, not-an-email, test@domain.com
      broken@@domain.com, "another.valid@company.com", 12345
    `;
    const result = parseRecipientText(content);

    expect(result.valid).toEqual([
      'valid.email@example.com',
      'test@domain.com',
      'another.valid@company.com'
    ]);
    expect(result.invalid).toEqual([
      'not-an-email',
      'broken@@domain.com',
      '12345'
    ]);
    expect(result.duplicates).toHaveLength(0);
    expect(result.totalRead).toBe(6);
  });

  it('should deduplicate email addresses case-insensitively', () => {
    const content = `
      user@example.com
      USER@EXAMPLE.COM
      User@Example.Com
      another@domain.com
      ANOTHER@DOMAIN.COM
    `;
    const result = parseRecipientText(content);

    expect(result.valid).toEqual([
      'user@example.com',
      'another@domain.com'
    ]);
    expect(result.duplicates).toEqual([
      'USER@EXAMPLE.COM',
      'User@Example.Com',
      'ANOTHER@DOMAIN.COM'
    ]);
    expect(result.invalid).toHaveLength(0);
    expect(result.totalRead).toBe(5);
  });

  it('should handle completely empty files or blank whitespace', () => {
    expect(parseRecipientText('')).toEqual({
      valid: [],
      invalid: [],
      duplicates: [],
      totalRead: 0
    });

    expect(parseRecipientText('   \n\r\t  \n  ')).toEqual({
      valid: [],
      invalid: [],
      duplicates: [],
      totalRead: 0
    });
  });

  it('should ignore recognized first-row CSV headers and not count them as valid, invalid, duplicate, or totalRead', () => {
    const headers = [
      'email',
      'EMAIL',
      'Email Address',
      'email_address',
      'recipient',
      'Recipient Email',
      'recipient_email',
      '"  RECIPIENT_EMAIL  "'
    ];

    for (const header of headers) {
      const csv = `${header}\nalice@example.com\nbob@example.com`;
      const result = parseRecipientText(csv, { isCsv: true });

      expect(result.valid).toEqual(['alice@example.com', 'bob@example.com']);
      expect(result.invalid).toHaveLength(0);
      expect(result.duplicates).toHaveLength(0);
      expect(result.totalRead).toBe(2);
    }
  });

  it('should parse CSV without a header where the first row contains a valid email', () => {
    const csvWithoutHeader = 'first.user@example.com\nsecond.user@example.com';
    const result = parseRecipientText(csvWithoutHeader, { isCsv: true });

    expect(result.valid).toEqual(['first.user@example.com', 'second.user@example.com']);
    expect(result.invalid).toHaveLength(0);
    expect(result.duplicates).toHaveLength(0);
    expect(result.totalRead).toBe(2);
  });

  it('should NOT apply header removal to ordinary TXT files', () => {
    const txtWithHeaderWord = 'email\nalice@example.com';
    const result = parseRecipientText(txtWithHeaderWord, { isCsv: false });

    // In TXT mode, "email" is treated as an invalid email string, not a CSV header
    expect(result.valid).toEqual(['alice@example.com']);
    expect(result.invalid).toEqual(['email']);
    expect(result.duplicates).toHaveLength(0);
    expect(result.totalRead).toBe(2);
  });

  it('should not treat header words appearing in later non-first rows as headers', () => {
    const csv = 'lead1@reachinbox.ai\nemail\nlead2@reachinbox.ai';
    const result = parseRecipientText(csv, { isCsv: true });

    // Since "email" is on row 2, it is not a first-row header and gets counted as invalid
    expect(result.valid).toEqual(['lead1@reachinbox.ai', 'lead2@reachinbox.ai']);
    expect(result.invalid).toEqual(['email']);
    expect(result.totalRead).toBe(3);
  });
});

describe('parseRecipientFile', () => {
  it('should reject unsupported file types like .pdf or .json', async () => {
    const fakeFile = new File(['some content'], 'document.pdf', { type: 'application/pdf' });
    await expect(parseRecipientFile(fakeFile)).rejects.toThrow('Unsupported file format');
  });

  it('should reject files exceeding the maximum file size limit', async () => {
    const largeBlob = new Blob(['x'.repeat(100)]);
    const fakeFile = new File([largeBlob], 'recipients.csv', { type: 'text/csv' });
    Object.defineProperty(fakeFile, 'size', { value: (MAX_FILE_SIZE_MB + 1) * 1024 * 1024 });

    await expect(parseRecipientFile(fakeFile)).rejects.toThrow('exceeds the');
  });

  it('should parse valid .csv file with recognized header and ignore header', async () => {
    const csvContent = 'Email Address\nlead1@reachinbox.ai, lead2@reachinbox.ai\nlead3@reachinbox.ai';
    const file = new File([csvContent], 'leads.csv', { type: 'text/csv' });

    const result = await parseRecipientFile(file);
    expect(result.valid).toEqual([
      'lead1@reachinbox.ai',
      'lead2@reachinbox.ai',
      'lead3@reachinbox.ai'
    ]);
    expect(result.invalid).toHaveLength(0);
    expect(result.totalRead).toBe(3);
  });

  it('should parse valid .csv file without a header correctly', async () => {
    const csvContent = 'lead1@reachinbox.ai, lead2@reachinbox.ai\nlead3@reachinbox.ai';
    const file = new File([csvContent], 'leads.csv', { type: 'text/csv' });

    const result = await parseRecipientFile(file);
    expect(result.valid).toEqual([
      'lead1@reachinbox.ai',
      'lead2@reachinbox.ai',
      'lead3@reachinbox.ai'
    ]);
    expect(result.totalRead).toBe(3);
  });

  it('should parse valid .txt file without header removal', async () => {
    const txtContent = 'email\ncontact1@test.com\ncontact2@test.com';
    const file = new File([txtContent], 'contacts.txt', { type: 'text/plain' });

    const result = await parseRecipientFile(file);
    expect(result.valid).toEqual([
      'contact1@test.com',
      'contact2@test.com'
    ]);
    expect(result.invalid).toEqual(['email']);
    expect(result.totalRead).toBe(3);
  });
});
