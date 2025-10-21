/**
 * DocumentProcessor Tests
 * Integration tests for the complete document processing pipeline
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { DocumentProcessor } from '../document-processing/DocumentProcessor';
import { RecursiveCharacterTextSplitter } from '../document-processing/TextChunker';

describe('DocumentProcessor', () => {
  let processor: DocumentProcessor;

  beforeEach(() => {
    processor = new DocumentProcessor({
      chunkingConfig: {
        chunkSize: 100,
        chunkOverlap: 20,
      },
      extractorConfig: {
        enableOCRFallback: false, // Disable for faster tests
      },
    });
  });

  describe('basic processing', () => {
    it('should process plain text document', async () => {
      const text = 'This is a test document. It contains multiple sentences. ' +
                   'Each sentence provides some information. We need to test chunking.';
      const buffer = Buffer.from(text);

      const chunks = await processor.processDocument(
        buffer,
        'text/plain',
        { filename: 'test.txt' }
      );

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]).toHaveProperty('text');
      expect(chunks[0]).toHaveProperty('index');
      expect(chunks[0]).toHaveProperty('metadata');
      expect(chunks[0].index).toBe(0);
    });

    it('should include metadata in chunks', async () => {
      const text = 'Short text';
      const buffer = Buffer.from(text);

      const chunks = await processor.processDocument(
        buffer,
        'text/plain',
        { filename: 'metadata-test.txt' }
      );

      expect(chunks[0].metadata.filename).toBe('metadata-test.txt');
      expect(chunks[0].metadata.mimeType).toBe('text/plain');
      expect(chunks[0].metadata.extractedAt).toBeInstanceOf(Date);
    });

    it('should assign sequential indices to chunks', async () => {
      const text = 'A'.repeat(500); // Long text to force multiple chunks
      const buffer = Buffer.from(text);

      const chunks = await processor.processDocument(
        buffer,
        'text/plain'
      );

      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk, i) => {
        expect(chunk.index).toBe(i);
      });
    });

    it('should set total chunks in metadata', async () => {
      const text = 'A'.repeat(500);
      const buffer = Buffer.from(text);

      const chunks = await processor.processDocument(
        buffer,
        'text/plain'
      );

      chunks.forEach((chunk) => {
        expect(chunk.metadata.totalChunks).toBe(chunks.length);
      });
    });
  });

  describe('chunking strategies', () => {
    it('should use default chunking strategy', async () => {
      const text = 'Test text for default chunking strategy';
      const buffer = Buffer.from(text);

      const chunks = await processor.processDocument(buffer, 'text/plain');

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].metadata.chunkingStrategy).toBe('default');
    });

    it('should use custom chunking strategy', async () => {
      const customProcessor = new DocumentProcessor({
        customChunkers: [
          {
            name: 'tiny',
            chunker: new RecursiveCharacterTextSplitter({
              chunkSize: 20,
              chunkOverlap: 5,
            }),
          },
        ],
        defaultChunkingStrategy: 'tiny',
      });

      const text = 'A'.repeat(100);
      const buffer = Buffer.from(text);

      const chunks = await customProcessor.processDocument(buffer, 'text/plain');

      expect(chunks.length).toBeGreaterThan(3); // Small chunk size = many chunks
      expect(chunks[0].metadata.chunkingStrategy).toBe('tiny');
    });

    it('should allow override of chunking strategy per document', async () => {
      const customProcessor = new DocumentProcessor({
        customChunkers: [
          {
            name: 'large',
            chunker: new RecursiveCharacterTextSplitter({
              chunkSize: 500,
              chunkOverlap: 50,
            }),
          },
        ],
      });

      const text = 'A'.repeat(300);
      const buffer = Buffer.from(text);

      const chunks = await customProcessor.processDocument(
        buffer,
        'text/plain',
        { chunkingStrategy: 'large' }
      );

      expect(chunks[0].metadata.chunkingStrategy).toBe('large');
    });
  });

  describe('skip chunking', () => {
    it('should return single chunk when skipChunking is true', async () => {
      const text = 'A'.repeat(500);
      const buffer = Buffer.from(text);

      const chunks = await processor.processDocument(
        buffer,
        'text/plain',
        { skipChunking: true }
      );

      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe(text);
    });

    it('should still include metadata when skipping chunking', async () => {
      const text = 'Short text';
      const buffer = Buffer.from(text);

      const chunks = await processor.processDocument(
        buffer,
        'text/plain',
        { filename: 'skip-test.txt', skipChunking: true }
      );

      expect(chunks[0].metadata.filename).toBe('skip-test.txt');
      expect(chunks[0].metadata.totalChunks).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('should handle empty document', async () => {
      const buffer = Buffer.from('');

      const chunks = await processor.processDocument(buffer, 'text/plain');

      expect(chunks).toHaveLength(0);
    });

    it('should handle very short text', async () => {
      const buffer = Buffer.from('Hi');

      const chunks = await processor.processDocument(buffer, 'text/plain');

      expect(chunks).toHaveLength(1);
      expect(chunks[0].text).toBe('Hi');
    });

    it('should handle text with only whitespace', async () => {
      const buffer = Buffer.from('   \n\n   ');

      const chunks = await processor.processDocument(buffer, 'text/plain');

      // Should either be empty or single chunk
      expect(Array.isArray(chunks)).toBe(true);
    });

    it('should handle unicode text', async () => {
      const text = 'Hello 世界! 🚀 Émojis';
      const buffer = Buffer.from(text);

      const chunks = await processor.processDocument(buffer, 'text/plain');

      expect(chunks[0].text).toContain('世界');
      expect(chunks[0].text).toContain('🚀');
    });
  });

  describe('different document types', () => {
    it('should process markdown documents', async () => {
      const markdown = '# Heading\n\n## Subheading\n\nThis is **bold** text.';
      const buffer = Buffer.from(markdown);

      const chunks = await processor.processDocument(
        buffer,
        'text/markdown',
        { filename: 'test.md' }
      );

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].metadata.mimeType).toBe('text/markdown');
    });

    it('should process JSON documents', async () => {
      const json = JSON.stringify({
        title: 'Test Document',
        content: 'This is the content',
        tags: ['test', 'document'],
      }, null, 2);
      const buffer = Buffer.from(json);

      const chunks = await processor.processDocument(
        buffer,
        'application/json'
      );

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].text).toContain('Test Document');
    });
  });

  describe('error handling', () => {
    it('should throw error for unsupported document type', async () => {
      const buffer = Buffer.from('test');

      await expect(
        processor.processDocument(buffer, 'application/unsupported')
      ).rejects.toThrow();
    });

    it('should throw error for invalid chunking strategy', async () => {
      const buffer = Buffer.from('test');

      await expect(
        processor.processDocument(buffer, 'text/plain', {
          chunkingStrategy: 'nonexistent',
        })
      ).rejects.toThrow();
    });
  });

  describe('utility methods', () => {
    it('should return supported types', () => {
      const types = processor.getSupportedTypes();

      expect(Array.isArray(types)).toBe(true);
      expect(types).toContain('text/plain');
      expect(types.length).toBeGreaterThan(0);
    });

    it('should return available chunking strategies', () => {
      const strategies = processor.getChunkingStrategies();

      expect(Array.isArray(strategies)).toBe(true);
      expect(strategies).toContain('default');
    });

    it('should include custom strategies in list', () => {
      const customProcessor = new DocumentProcessor({
        customChunkers: [
          {
            name: 'custom1',
            chunker: new RecursiveCharacterTextSplitter({ chunkSize: 50 }),
          },
          {
            name: 'custom2',
            chunker: new RecursiveCharacterTextSplitter({ chunkSize: 200 }),
          },
        ],
      });

      const strategies = customProcessor.getChunkingStrategies();
      expect(strategies).toContain('custom1');
      expect(strategies).toContain('custom2');
    });
  });

  describe('configuration', () => {
    it('should use configured chunk size', async () => {
      const smallChunkProcessor = new DocumentProcessor({
        chunkingConfig: {
          chunkSize: 30,
          chunkOverlap: 5,
        },
      });

      const text = 'A'.repeat(200);
      const buffer = Buffer.from(text);

      const chunks = await smallChunkProcessor.processDocument(buffer, 'text/plain');

      // Small chunk size should create more chunks
      expect(chunks.length).toBeGreaterThan(5);
    });

    it('should handle zero overlap', async () => {
      const noOverlapProcessor = new DocumentProcessor({
        chunkingConfig: {
          chunkSize: 50,
          chunkOverlap: 0,
        },
      });

      const text = 'A'.repeat(200);
      const buffer = Buffer.from(text);

      const chunks = await noOverlapProcessor.processDocument(buffer, 'text/plain');

      expect(chunks.length).toBeGreaterThan(0);
    });
  });
});
