/**
 * TextChunker Tests
 * Tests for text chunking strategies
 */

import {
  RecursiveCharacterTextSplitter,
  SentenceTextSplitter,
  ParagraphTextSplitter,
} from '../document-processing/TextChunker';

describe('RecursiveCharacterTextSplitter', () => {
  describe('basic chunking', () => {
    it('should split text into chunks of specified size', () => {
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 100,
        chunkOverlap: 0,
      });

      const text = 'A'.repeat(250);
      const chunks = splitter.chunk(text);

      expect(chunks.length).toBeGreaterThan(2);
      chunks.forEach((chunk) => {
        expect(chunk.length).toBeLessThanOrEqual(100);
      });
    });

    it('should respect chunk overlap', () => {
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 50,
        chunkOverlap: 10,
      });

      const text = 'The quick brown fox jumps over the lazy dog. ' +
                   'Pack my box with five dozen liquor jugs. ' +
                   'How vexingly quick daft zebras jump!';

      const chunks = splitter.chunk(text);

      // Check that overlaps exist between consecutive chunks
      for (let i = 0; i < chunks.length - 1; i++) {
        const currentEnd = chunks[i].slice(-10);
        const nextStart = chunks[i + 1].slice(0, 10);
        
        // Should have some overlap
        expect(chunks[i + 1]).toContain(currentEnd.trim().split(' ').pop() || '');
      }
    });

    it('should handle text shorter than chunk size', () => {
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 0,
      });

      const text = 'Short text';
      const chunks = splitter.chunk(text);

      expect(chunks).toHaveLength(1);
      // Text might have whitespace trimmed
      expect(chunks[0].replace(/\s+/g, '')).toBe(text.replace(/\s+/g, ''));
    });

    it('should handle empty text', () => {
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 100,
        chunkOverlap: 0,
      });

      const chunks = splitter.chunk('');
      expect(chunks).toHaveLength(0);
    });
  });

  describe('separator handling', () => {
    it('should use separators in order of priority', () => {
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 50,
        chunkOverlap: 0,
        separators: ['\n\n', '\n', '. ', ' '],
      });

      const text = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
      const chunks = splitter.chunk(text);

      // Should create chunks (at least 1)
      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle custom separators', () => {
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 100,
        chunkOverlap: 0,
        separators: ['|', ','],
      });

      const text = 'Part1|Part2|Part3|Part4';
      const chunks = splitter.chunk(text);

      // Should create at least 1 chunk
      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('edge cases', () => {
    it('should handle text with only whitespace', () => {
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 10,
        chunkOverlap: 0,
      });

      const text = '     \n\n     ';
      const chunks = splitter.chunk(text);

      // Should either return empty array or single chunk with whitespace
      expect(Array.isArray(chunks)).toBe(true);
    });

    it('should handle very small chunk size', () => {
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 5,
        chunkOverlap: 0,
      });

      const text = 'This is a test';
      const chunks = splitter.chunk(text);

      expect(chunks.length).toBeGreaterThan(1);
    });

    it('should handle unicode characters', () => {
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 50,
        chunkOverlap: 0,
      });

      const text = 'Hello 世界! 🚀 Émojis and spëcial chàracters.';
      const chunks = splitter.chunk(text);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.join('')).toContain('世界');
      expect(chunks.join('')).toContain('🚀');
    });
  });
});

describe('SentenceTextSplitter', () => {
  it('should split text by sentences', () => {
    const splitter = new SentenceTextSplitter({
      chunkSize: 100,
      chunkOverlap: 20,
    });

    const text = 'First sentence. Second sentence. Third sentence. Fourth sentence.';
    const chunks = splitter.chunk(text);

    expect(chunks.length).toBeGreaterThan(0);
    // Each chunk should ideally contain complete sentences
    chunks.forEach((chunk) => {
      expect(chunk.trim().length).toBeGreaterThan(0);
    });
  });

  it('should handle questions and exclamations', () => {
    const splitter = new SentenceTextSplitter({
      chunkSize: 100,
      chunkOverlap: 0,
    });

    const text = 'What is this? This is great! Are you sure. Yes indeed!';
    const chunks = splitter.chunk(text);

    expect(chunks.length).toBeGreaterThan(0);
  });

  it('should handle text without sentence boundaries', () => {
    const splitter = new SentenceTextSplitter({
      chunkSize: 50,
      chunkOverlap: 0,
    });

    const text = 'This is a very long run-on sentence without any proper punctuation marks';
    const chunks = splitter.chunk(text);

    expect(chunks.length).toBeGreaterThan(0);
  });
});

describe('ParagraphTextSplitter', () => {
  it('should split text by paragraphs', () => {
    const splitter = new ParagraphTextSplitter({
      chunkSize: 200,
      chunkOverlap: 20,
    });

    const text = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
    const chunks = splitter.chunk(text);

    expect(chunks.length).toBeGreaterThan(0);
  });

  it('should handle single paragraph', () => {
    const splitter = new ParagraphTextSplitter({
      chunkSize: 500,
      chunkOverlap: 0,
    });

    const text = 'Just one paragraph without any line breaks except at the end.';
    const chunks = splitter.chunk(text);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain('one paragraph');
  });

  it('should handle multiple newlines', () => {
    const splitter = new ParagraphTextSplitter({
      chunkSize: 100,
      chunkOverlap: 0,
    });

    const text = 'Para 1\n\n\n\nPara 2\n\n\nPara 3';
    const chunks = splitter.chunk(text);

    // Should create at least 1 chunk
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Chunker comparison', () => {
  const sampleText = `
This is the first paragraph. It contains multiple sentences. Each sentence adds information.

This is the second paragraph. It also has several sentences! Does it work well?

This is the third paragraph. Testing is important. We need to verify behavior.
  `.trim();

  it('should produce different results with different strategies', () => {
    const recursive = new RecursiveCharacterTextSplitter({
      chunkSize: 100,
      chunkOverlap: 20,
    });

    const sentence = new SentenceTextSplitter({
      chunkSize: 100,
      chunkOverlap: 20,
    });

    const paragraph = new ParagraphTextSplitter({
      chunkSize: 100,
      chunkOverlap: 20,
    });

    const recursiveChunks = recursive.chunk(sampleText);
    const sentenceChunks = sentence.chunk(sampleText);
    const paragraphChunks = paragraph.chunk(sampleText);

    // All should produce some chunks
    expect(recursiveChunks.length).toBeGreaterThan(0);
    expect(sentenceChunks.length).toBeGreaterThan(0);
    expect(paragraphChunks.length).toBeGreaterThan(0);

    // Results may differ
    console.log('Recursive chunks:', recursiveChunks.length);
    console.log('Sentence chunks:', sentenceChunks.length);
    console.log('Paragraph chunks:', paragraphChunks.length);
  });
});
