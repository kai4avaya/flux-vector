/**
 * Integration Tests
 * End-to-end tests for the complete document processing and search pipeline
 */

import { describe, it, expect,afterEach, beforeEach } from '@jest/globals';
import { DocumentProcessor } from '../document-processing/DocumentProcessor';
import VectorSearchManager from '../embeddings/VectorSearchManager';
import { SimpleMockEmbedding } from './mocks/MockEmbedding';

describe('Integration: Document Processing + Vector Search', () => {
  let processor: DocumentProcessor;
  let searchManager: VectorSearchManager;

  beforeEach(async () => {
    processor = new DocumentProcessor({
      chunkingConfig: {
        chunkSize: 200,
        chunkOverlap: 50,
      },
      extractorConfig: {
        enableOCRFallback: false,
      },
    });

    searchManager = new VectorSearchManager({
      embeddingEngine: new SimpleMockEmbedding(10),
      indexConfig: {
        useIndexedDB: false,
      },
    });

    await searchManager.contentStore.documents.clear();
  });

  afterEach(async () => {
    await searchManager.contentStore.delete();
  });

  describe('PDF to Search Pipeline', () => {
    it('should process document and make it searchable', async () => {
      const document = `
        Machine Learning Basics
        
        Machine learning is a branch of artificial intelligence that focuses on 
        building systems that can learn from data. These systems improve their 
        performance over time without being explicitly programmed.
        
        Deep Learning
        
        Deep learning is a subset of machine learning that uses neural networks 
        with multiple layers. It has revolutionized fields like computer vision 
        and natural language processing.
      `.trim();

      const buffer = Buffer.from(document);

      // Step 1: Process document into chunks
      const chunks = await processor.processDocument(
        buffer,
        'text/plain',
        { filename: 'ml-basics.txt' }
      );

      expect(chunks.length).toBeGreaterThan(0);

      // Step 2: Index all chunks
      for (const chunk of chunks) {
        const id = `${chunk.metadata.filename}_chunk_${chunk.index}`;
        await searchManager.addDocument(chunk.text, id);
      }

      // Step 3: Search
      const results = await searchManager.search('neural networks', 3);

      // Step 4: Verify
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].text).toBeDefined();
    });

    it('should handle multiple documents', async () => {
      const doc1 = 'Python is a high-level programming language known for its simplicity.';
      const doc2 = 'JavaScript is the language of the web, running in browsers and servers.';
      const doc3 = 'TypeScript extends JavaScript by adding static types to the language.';

      const documents = [
        { content: doc1, name: 'python.txt' },
        { content: doc2, name: 'javascript.txt' },
        { content: doc3, name: 'typescript.txt' },
      ];

      // Process and index all documents
      for (const doc of documents) {
        const buffer = Buffer.from(doc.content);
        const chunks = await processor.processDocument(
          buffer,
          'text/plain',
          { filename: doc.name }
        );

        for (const chunk of chunks) {
          await searchManager.addDocument(
            chunk.text,
            `${doc.name}_${chunk.index}`
          );
        }
      }

      // Search across all documents
      const results = await searchManager.search('web language', 5);

      expect(results.length).toBeGreaterThan(0);
      expect(await searchManager.size()).toBe(3);
    });

    it('should maintain chunk metadata through pipeline', async () => {
      const text = 'A'.repeat(500); // Force multiple chunks
      const buffer = Buffer.from(text);

      const chunks = await processor.processDocument(
        buffer,
        'text/plain',
        { filename: 'test.txt' }
      );

      expect(chunks.length).toBeGreaterThan(1);

      // Index with metadata preservation
      for (const chunk of chunks) {
        const id = `${chunk.metadata.filename}_${chunk.index}`;
        await searchManager.addDocument(chunk.text, id);
      }

      // Verify we can retrieve by constructed IDs
      const firstDoc = await searchManager.contentStore.documents.get('test.txt_0');
      const secondDoc = await searchManager.contentStore.documents.get('test.txt_1');

      expect(firstDoc).toBeDefined();
      expect(secondDoc).toBeDefined();
    });
  });

  describe('Batch Processing', () => {
    it('should efficiently process multiple documents', async () => {
      const documents = Array(10).fill(0).map((_, i) => ({
        content: `Document ${i}: This is test content for document number ${i}.`,
        filename: `doc${i}.txt`,
      }));

      let totalChunks = 0;

      for (const doc of documents) {
        const buffer = Buffer.from(doc.content);
        const chunks = await processor.processDocument(
          buffer,
          'text/plain',
          { filename: doc.filename }
        );

        for (const chunk of chunks) {
          await searchManager.addDocument(
            chunk.text,
            `${doc.filename}_${chunk.index}`
          );
          totalChunks++;
        }
      }

      expect(totalChunks).toBeGreaterThan(0);
      expect(await searchManager.size()).toBe(totalChunks);

      // Search should work across all documents
      const results = await searchManager.search('document content', 10);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('Different Document Formats', () => {
    it('should handle plain text', async () => {
      const text = 'Plain text content for testing';
      const buffer = Buffer.from(text);

      const chunks = await processor.processDocument(buffer, 'text/plain');
      
      for (const chunk of chunks) {
        await searchManager.addDocument(chunk.text);
      }

      const results = await searchManager.search('testing', 1);
      expect(results.length).toBeGreaterThan(0);
    });

    it('should handle markdown', async () => {
      const markdown = `
# Heading
## Subheading
This is **bold** and this is *italic*.
      `.trim();

      const buffer = Buffer.from(markdown);
      const chunks = await processor.processDocument(buffer, 'text/markdown');

      for (const chunk of chunks) {
        await searchManager.addDocument(chunk.text);
      }

      const results = await searchManager.search('bold', 1);
      expect(results.length).toBeGreaterThan(0);
    });

    it('should handle JSON', async () => {
      const json = JSON.stringify({
        title: 'Test Document',
        description: 'This is a test',
        tags: ['test', 'json', 'document'],
      }, null, 2);

      const buffer = Buffer.from(json);
      const chunks = await processor.processDocument(buffer, 'application/json');

      for (const chunk of chunks) {
        await searchManager.addDocument(chunk.text);
      }

      const results = await searchManager.search('test document', 1);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('Chunking Strategies', () => {
    it('should apply different chunking strategies', async () => {
      const text = 'A'.repeat(1000);
      const buffer = Buffer.from(text);

      // Small chunks
      const smallProcessor = new DocumentProcessor({
        chunkingConfig: {
          chunkSize: 100,
          chunkOverlap: 20,
        },
      });

      const smallChunks = await smallProcessor.processDocument(buffer, 'text/plain');

      // Large chunks
      const largeProcessor = new DocumentProcessor({
        chunkingConfig: {
          chunkSize: 500,
          chunkOverlap: 50,
        },
      });

      const largeChunks = await largeProcessor.processDocument(buffer, 'text/plain');

      // Small chunk size should create more chunks
      expect(smallChunks.length).toBeGreaterThan(largeChunks.length);

      // Index small chunks
      for (const chunk of smallChunks) {
        await searchManager.addDocument(chunk.text);
      }

      expect(await searchManager.size()).toBe(smallChunks.length);
    });
  });

  describe('Real-world Scenarios', () => {
    it('should handle a knowledge base scenario', async () => {
      const articles = [
        {
          title: 'Introduction to React',
          content: 'React is a JavaScript library for building user interfaces. ' +
                   'It was developed by Facebook and is widely used for web applications.',
          filename: 'react-intro.txt',
        },
        {
          title: 'Vue.js Basics',
          content: 'Vue.js is a progressive framework for building user interfaces. ' +
                   'It is designed to be incrementally adoptable.',
          filename: 'vue-basics.txt',
        },
        {
          title: 'Angular Overview',
          content: 'Angular is a platform for building mobile and desktop web applications. ' +
                   'It is maintained by Google and the open-source community.',
          filename: 'angular-overview.txt',
        },
      ];

      // Build knowledge base
      for (const article of articles) {
        const fullText = `${article.title}\n\n${article.content}`;
        const buffer = Buffer.from(fullText);
        
        const chunks = await processor.processDocument(
          buffer,
          'text/plain',
          { filename: article.filename }
        );

        for (const chunk of chunks) {
          await searchManager.addDocument(
            chunk.text,
            `${article.filename}_${chunk.index}`
          );
        }
      }

      // Query the knowledge base
      const reactResults = await searchManager.search('JavaScript library UI', 3);
      const frameworkResults = await searchManager.search('framework', 3);

      expect(reactResults.length).toBeGreaterThan(0);
      expect(frameworkResults.length).toBeGreaterThan(0);
      expect(await searchManager.size()).toBe(3); // 3 articles = 3 chunks
    });

    it('should support FAQ matching', async () => {
      const faqs = [
        'Q: How do I reset my password? A: Click on forgot password link.',
        'Q: Where is my order? A: Check the orders page in your account.',
        'Q: How do I cancel my subscription? A: Go to settings and click cancel.',
        'Q: Can I change my email? A: Yes, update it in account settings.',
      ];

      // Index FAQs
      for (let i = 0; i < faqs.length; i++) {
        const buffer = Buffer.from(faqs[i]);
        const chunks = await processor.processDocument(
          buffer,
          'text/plain',
          { filename: `faq${i}.txt`, skipChunking: true }
        );

        await searchManager.addDocument(chunks[0].text, `faq${i}`);
      }

      // User queries
      const passwordQuery = await searchManager.search('forgot password', 1);
      const orderQuery = await searchManager.search('track order', 1);

      expect(passwordQuery.length).toBeGreaterThan(0);
      expect(orderQuery.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle empty documents gracefully', async () => {
      const buffer = Buffer.from('');
      const chunks = await processor.processDocument(buffer, 'text/plain');

      expect(chunks).toHaveLength(0);
      
      // Should not crash when searching empty index
      const results = await searchManager.search('anything', 5);
      expect(results).toHaveLength(0);
    });

    it('should handle unsupported document types', async () => {
      const buffer = Buffer.from('test');

      await expect(
        processor.processDocument(buffer, 'application/unsupported')
      ).rejects.toThrow();
    });
  });

  describe('Performance Characteristics', () => {
    it('should handle reasonably sized documents', async () => {
      const largeText = 'Sample text. '.repeat(1000); // ~13KB
      const buffer = Buffer.from(largeText);

      const startTime = Date.now();
      
      const chunks = await processor.processDocument(buffer, 'text/plain');
      
      for (const chunk of chunks) {
        await searchManager.addDocument(chunk.text);
      }

      const results = await searchManager.search('sample', 5);
      
      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(chunks.length).toBeGreaterThan(0);
      expect(results.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(10000); // Should complete in 10 seconds
    });
  });
});
