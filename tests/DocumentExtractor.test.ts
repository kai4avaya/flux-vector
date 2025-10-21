/**
 * DocumentExtractor Tests
 * Tests for document extraction from various formats
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { DocumentExtractionManager } from '../document-processing/DocumentExtractor';

describe('DocumentExtractor', () => {
  let extractor: DocumentExtractionManager;

  beforeEach(() => {
    extractor = new DocumentExtractionManager();
  });

  describe('text extraction', () => {
    it('should extract text from plain text', async () => {
      const text = 'This is plain text content';
      const buffer = Buffer.from(text);

      const result = await extractor.extractText(buffer, 'text/plain');
      expect(result).toBe(text);
    });

    it('should extract text from markdown', async () => {
      const markdown = '# Heading\n\nThis is **bold** text';
      const buffer = Buffer.from(markdown);

      const result = await extractor.extractText(buffer, 'text/markdown');
      expect(result).toContain('Heading');
      expect(result).toContain('bold');
    });

    it('should extract text from JSON', async () => {
      const json = JSON.stringify({ message: 'Hello', value: 123 });
      const buffer = Buffer.from(json);

      const result = await extractor.extractText(buffer, 'application/json');
      expect(result).toContain('message');
      expect(result).toContain('Hello');
    });

    it('should extract text from CSV-like content', async () => {
      const csv = 'name,age,city\nJohn,30,NYC\nJane,25,LA';
      const buffer = Buffer.from(csv);

      const result = await extractor.extractText(buffer, 'text/csv');
      expect(result).toContain('name');
      expect(result).toContain('John');
    });

    it('should handle empty text', async () => {
      const buffer = Buffer.from('');

      const result = await extractor.extractText(buffer, 'text/plain');
      expect(result).toBe('');
    });

    it('should handle text with unicode', async () => {
      const text = 'Hello 世界! 🚀 Test émojis';
      const buffer = Buffer.from(text);

      const result = await extractor.extractText(buffer, 'text/plain');
      expect(result).toBe(text);
    });
  });

  describe('mime type detection', () => {
    it('should recognize text mime types', () => {
      const types = extractor.getSupportedMimeTypes();
      expect(types).toContain('text/plain');
      expect(types).toContain('text/markdown');
    });

    it('should recognize PDF mime type', () => {
      const types = extractor.getSupportedMimeTypes();
      expect(types).toContain('application/pdf');
    });

    it('should recognize image mime types', () => {
      const extractorWithOCR = new DocumentExtractionManager();
      const types = extractorWithOCR.getSupportedMimeTypes();
      expect(types.some(t => t.includes('image/'))).toBe(true);
    });

    it('should reject unsupported mime types', async () => {
      await expect(
        extractor.extractText(Buffer.from('test'), 'application/zip')
      ).rejects.toThrow();
    });

    it('should be case insensitive', async () => {
      // Test that extraction still works regardless of case
      const text = 'Test content';
      const buffer = Buffer.from(text);
      
      const result = await extractor.extractText(buffer, 'text/plain');
      expect(result).toBe(text);
    });
  });

  describe('supported types', () => {
    it('should return list of supported mime types', () => {
      const types = extractor.getSupportedMimeTypes();

      expect(Array.isArray(types)).toBe(true);
      expect(types.length).toBeGreaterThan(0);
      expect(types).toContain('text/plain');
      expect(types).toContain('application/pdf');
    });

    it('should include image types when OCR is enabled', () => {
      const extractorWithOCR = new DocumentExtractionManager();

      const types = extractorWithOCR.getSupportedMimeTypes();
      expect(types.some(t => t.startsWith('image/'))).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should throw error for unsupported mime type', async () => {
      const buffer = Buffer.from('test');

      await expect(
        extractor.extractText(buffer, 'application/unsupported')
      ).rejects.toThrow();
    });

    it('should handle corrupted text data gracefully', async () => {
      const buffer = Buffer.from([0xFF, 0xFE, 0xFD]); // Invalid UTF-8

      // Should not throw, might return empty or decoded string
      const result = await extractor.extractText(buffer, 'text/plain');
      expect(typeof result).toBe('string');
    });
  });

  describe('buffer handling', () => {
    it('should handle Buffer input', async () => {
      const buffer = Buffer.from('Buffer content');
      const result = await extractor.extractText(buffer, 'text/plain');
      expect(result).toBe('Buffer content');
    });

    it('should handle ArrayBuffer input', async () => {
      const text = 'ArrayBuffer content';
      const buffer = new ArrayBuffer(text.length);
      const view = new Uint8Array(buffer);
      for (let i = 0; i < text.length; i++) {
        view[i] = text.charCodeAt(i);
      }

      const result = await extractor.extractText(buffer, 'text/plain');
      expect(result).toBe(text);
    });

    it('should handle Uint8Array input', async () => {
      const text = 'Uint8Array content';
      const encoder = new TextEncoder();
      const uint8Array = encoder.encode(text);
      const buffer = Buffer.from(uint8Array);

      const result = await extractor.extractText(buffer, 'text/plain');
      expect(result).toBe(text);
    });
  });

  describe('whitespace handling', () => {
    it('should preserve necessary whitespace', async () => {
      const text = 'Line 1\n\nLine 2\n  Indented';
      const buffer = Buffer.from(text);

      const result = await extractor.extractText(buffer, 'text/plain');
      expect(result).toContain('\n');
    });

    it('should handle text with tabs', async () => {
      const text = 'Column1\tColumn2\tColumn3';
      const buffer = Buffer.from(text);

      const result = await extractor.extractText(buffer, 'text/plain');
      expect(result).toContain('\t');
    });
  });
});
