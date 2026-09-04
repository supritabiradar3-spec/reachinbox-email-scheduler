import React from 'react';

export interface HighlightSegment {
  text: string;
  isHighlighted: boolean;
}

/**
 * Safely parses an Elasticsearch snippet by extracting text enclosed in <em>...</em> tags.
 * Strips all literal <em> and </em> tags without executing arbitrary HTML or using dangerouslySetInnerHTML.
 */
export function parseHighlightSegments(input: string | null | undefined): HighlightSegment[] {
  if (!input || typeof input !== 'string') return [];

  const segments: HighlightSegment[] = [];
  const regex = /<em>([\s\S]*?)<\/em>/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(input)) !== null) {
    const matchStart = match.index;
    const matchEnd = regex.lastIndex;

    // Capture preceding plain text (cleaning any stray/unmatched em tags)
    if (matchStart > lastIndex) {
      const plainText = input.substring(lastIndex, matchStart).replace(/<\/?em>/gi, '');
      if (plainText) {
        segments.push({ text: plainText, isHighlighted: false });
      }
    }

    // Capture highlighted text
    const highlightedText = match[1].replace(/<\/?em>/gi, '');
    if (highlightedText) {
      segments.push({ text: highlightedText, isHighlighted: true });
    }

    lastIndex = matchEnd;
  }

  // Capture trailing plain text
  if (lastIndex < input.length) {
    const trailing = input.substring(lastIndex).replace(/<\/?em>/gi, '');
    if (trailing) {
      segments.push({ text: trailing, isHighlighted: false });
    }
  }

  return segments;
}

/**
 * React component to safely render search snippet text with styled highlights for matching terms.
 * All segments are rendered as plain React text children to prevent XSS.
 */
export function HighlightSnippet({
  snippet,
  className = ''
}: {
  snippet: string | null | undefined;
  className?: string;
}): React.JSX.Element | null {
  if (!snippet) return null;

  const segments = parseHighlightSegments(snippet);
  if (segments.length === 0) return null;

  return (
    <span className={className}>
      {segments.map((segment, idx) => {
        if (segment.isHighlighted) {
          return (
            <mark
              key={idx}
              className="bg-amber-500/25 text-amber-200 font-semibold px-1 py-0.5 rounded border border-amber-500/30 not-italic inline-block"
            >
              {segment.text}
            </mark>
          );
        }
        return <span key={idx}>{segment.text}</span>;
      })}
    </span>
  );
}
