import { describe, it, expect } from 'vitest';
import { parseHighlightSegments } from './highlightHelper';

describe('parseHighlightSegments', () => {
  it('1. should highlight matching text wrapped in <em> tags', () => {
    const snippet = 'Here is the <em>quarterly</em> financial <em>report</em>';
    const segments = parseHighlightSegments(snippet);

    expect(segments).toEqual([
      { text: 'Here is the ', isHighlighted: false },
      { text: 'quarterly', isHighlighted: true },
      { text: ' financial ', isHighlighted: false },
      { text: 'report', isHighlighted: true }
    ]);
  });

  it('2. should ensure literal marker tags (<em> and </em>) are not present in the output text', () => {
    const snippet = 'Welcome to <em>ReachInbox</em> Email Scheduler';
    const segments = parseHighlightSegments(snippet);

    for (const segment of segments) {
      expect(segment.text).not.toContain('<em>');
      expect(segment.text).not.toContain('</em>');
      expect(segment.text).not.toContain('<EM>');
      expect(segment.text).not.toContain('</EM>');
    }

    expect(segments).toEqual([
      { text: 'Welcome to ', isHighlighted: false },
      { text: 'ReachInbox', isHighlighted: true },
      { text: ' Email Scheduler', isHighlighted: false }
    ]);
  });

  it('3. should treat arbitrary HTML/script tags as plain text without interpretation', () => {
    const xssSnippet = '<script>alert("xss")</script> and <img src=x onerror=alert(1)> matched <em>search term</em>';
    const segments = parseHighlightSegments(xssSnippet);

    expect(segments).toEqual([
      { text: '<script>alert("xss")</script> and <img src=x onerror=alert(1)> matched ', isHighlighted: false },
      { text: 'search term', isHighlighted: true }
    ]);

    // Verify raw strings remain intact for safe React text node rendering
    expect(segments[0].text).toBe('<script>alert("xss")</script> and <img src=x onerror=alert(1)> matched ');
    expect(segments[1].text).toBe('search term');
  });

  it('4. should render snippet without markers normally as a single plain text segment', () => {
    const plainSnippet = 'Regular snippet with no highlights or special tokens.';
    const segments = parseHighlightSegments(plainSnippet);

    expect(segments).toEqual([
      { text: 'Regular snippet with no highlights or special tokens.', isHighlighted: false }
    ]);
  });

  it('5. should handle malformed or missing closing markers safely', () => {
    const unclosedSnippet = 'Unclosed <em>marker at the end';
    const segments = parseHighlightSegments(unclosedSnippet);

    expect(segments).toEqual([
      { text: 'Unclosed marker at the end', isHighlighted: false }
    ]);

    const strayClosingSnippet = 'Stray </em> closing tag here';
    const segments2 = parseHighlightSegments(strayClosingSnippet);

    expect(segments2).toEqual([
      { text: 'Stray  closing tag here', isHighlighted: false }
    ]);
  });

  it('6. should return empty array for empty or null inputs', () => {
    expect(parseHighlightSegments('')).toEqual([]);
    expect(parseHighlightSegments(null)).toEqual([]);
    expect(parseHighlightSegments(undefined)).toEqual([]);
  });
});
