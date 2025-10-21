/**
 * VectorSearchManager Tests
 * Integration tests for the complete vector search system
 */

import VectorSearchManager from '../embeddings/VectorSearchManager';
import { MockEmbeddingEngine, SimpleMockEmbedding } from './mocks/MockEmbedding';

describe('VectorSearchManager', () => {
  let searchManager: VectorSearchManager;

  beforeEach(async () => {
    // Use mock embedding for faster tests
    searchManager = new VectorSearchManager({
      embeddingEngine: new SimpleMockEmbedding(10),
      indexConfig: {
        distanceFunction: 'cosine-normalized',
        m: 8,
        efConstruction: 100,
        useIndexedDB: false, // Use in-memory for tests
      },
    });

    // Clear any existing data
    await searchManager.contentStore.documents.clear();
  });

  afterEach(async () => {
    // Clean up
    await searchManager.contentStore.delete();
  });

  describe('addDocument', () => {
    it('should add a document and return an ID', async () => {
      const text = 'This is a test document';
      const id = await searchManager.addDocument(text);

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('should accept custom IDs', async () => {
      const text = 'Test document';
      const customId = 'my-custom-id-123';

      const returnedId = await searchManager.addDocument(text, customId);

      expect(returnedId).toBe(customId);
    });

    it('should store document in ContentStore', async () => {
      const text = 'Document to store';
      const id = await searchManager.addDocument(text);

      const doc = await searchManager.contentStore.documents.get(id);
      expect(doc).toBeDefined();
      expect(doc?.text).toBe(text);
      expect(doc?.id).toBe(id);
    });

    it('should add document to vector index', async () => {
      const text = 'Indexed document';
      await searchManager.addDocument(text);

      const size = await searchManager.size();
      expect(size).toBe(1);
    });

    it('should handle multiple documents', async () => {
      await searchManager.addDocument('Document 1');
      await searchManager.addDocument('Document 2');
      await searchManager.addDocument('Document 3');

      const size = await searchManager.size();
      expect(size).toBe(3);
    });

    it('should handle empty text', async () => {
      const id = await searchManager.addDocument('');
      expect(id).toBeDefined();

      const doc = await searchManager.contentStore.documents.get(id);
      expect(doc?.text).toBe('');
    });

    it('should handle long text', async () => {
      const longText = 'A'.repeat(10000);
      const id = await searchManager.addDocument(longText);

      const doc = await searchManager.contentStore.documents.get(id);
      expect(doc?.text.length).toBe(10000);
    });

    it('should handle special characters', async () => {
      const specialText = 'Hello 世界! 🚀 Test émojis & symbols @#$%';
      const id = await searchManager.addDocument(specialText);

      const doc = await searchManager.contentStore.documents.get(id);
      expect(doc?.text).toBe(specialText);
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      // Add some documents
      await searchManager.addDocument('The quick brown fox jumps over the lazy dog', 'doc1');
      await searchManager.addDocument('A fast brown animal leaps over a sleepy canine', 'doc2');
      await searchManager.addDocument('Python is a programming language', 'doc3');
      await searchManager.addDocument('JavaScript is used for web development', 'doc4');
    });

    it('should return search results', async () => {
      const results = await searchManager.search('fox jumps', 2);

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
    });

    it('should return results with correct structure', async () => {
      const results = await searchManager.search('programming', 1);

      expect(results[0]).toHaveProperty('key');
      expect(results[0]).toHaveProperty('text');
      expect(results[0]).toHaveProperty('distance');
      
      expect(typeof results[0].key).toBe('string');
      expect(typeof results[0].text).toBe('string');
      expect(typeof results[0].distance).toBe('number');
    });

    it('should return original text in results', async () => {
      const results = await searchManager.search('Python', 1);

      // Should return one of the programming languages we added
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].text).toBeDefined();
      expect(typeof results[0].text).toBe('string');
      // Verify it's one of our added documents
      const validTexts = ['Python is a programming language', 'JavaScript is used for web development'];
      expect(validTexts.some(text => results[0].text.includes(text.split(' ')[0]))).toBe(true);
    });

    it('should respect k parameter', async () => {
      const results1 = await searchManager.search('language', 1);
      const results2 = await searchManager.search('language', 2);
      const results3 = await searchManager.search('language', 3);

      expect(results1.length).toBeLessThanOrEqual(1);
      expect(results2.length).toBeLessThanOrEqual(2);
      expect(results3.length).toBeLessThanOrEqual(3);
    });

    it('should return distance scores', async () => {
      const results = await searchManager.search('fox', 2);

      results.forEach(result => {
        expect(result.distance).toBeGreaterThanOrEqual(0);
        expect(result.distance).toBeLessThanOrEqual(2);
      });
    });

    it('should handle queries with no results', async () => {
      // Clear all documents
      await searchManager.contentStore.documents.clear();

      const results = await searchManager.search('anything', 5);
      expect(results).toHaveLength(0);
    });

    it('should handle empty query', async () => {
      const results = await searchManager.search('', 5);
      expect(Array.isArray(results)).toBe(true);
    });

    it('should handle k larger than document count', async () => {
      const results = await searchManager.search('test', 100);
      
      // Should return all documents (4 in this case)
      expect(results.length).toBeLessThanOrEqual(4);
    });

    it('should use default k value', async () => {
      const results = await searchManager.search('test');
      
      // Default k is 3
      expect(results.length).toBeLessThanOrEqual(3);
    });
  });

  describe('size', () => {
    it('should return 0 for empty index', async () => {
      const size = await searchManager.size();
      expect(size).toBe(0);
    });

    it('should return correct count after adding documents', async () => {
      await searchManager.addDocument('Doc 1');
      expect(await searchManager.size()).toBe(1);

      await searchManager.addDocument('Doc 2');
      expect(await searchManager.size()).toBe(2);

      await searchManager.addDocument('Doc 3');
      expect(await searchManager.size()).toBe(3);
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete workflow: add -> search -> retrieve', async () => {
      // Add documents
      const id1 = await searchManager.addDocument('Machine learning is a subset of AI');
      const id2 = await searchManager.addDocument('Deep learning uses neural networks');
      
      // Search
      const results = await searchManager.search('artificial intelligence', 2);
      
      // Verify results
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].text).toBeDefined();
      
      // Retrieve original
      const doc = await searchManager.contentStore.documents.get(results[0].key);
      expect(doc).toBeDefined();
    });

    it('should maintain consistency between index and store', async () => {
      const docs = [
        { text: 'Document A', id: 'id-a' },
        { text: 'Document B', id: 'id-b' },
        { text: 'Document C', id: 'id-c' },
      ];

      // Add all documents
      for (const doc of docs) {
        await searchManager.addDocument(doc.text, doc.id);
      }

      // Verify in index
      const indexSize = await searchManager.size();
      expect(indexSize).toBe(3);

      // Verify in content store
      const storeCount = await searchManager.contentStore.documents.count();
      expect(storeCount).toBe(3);

      // Verify each document
      for (const doc of docs) {
        const stored = await searchManager.contentStore.documents.get(doc.id);
        expect(stored?.text).toBe(doc.text);
      }
    });

    it('should handle batch operations', async () => {
      const documents = Array(20).fill(0).map((_, i) => 
        `Document number ${i} with some content`
      );

      // Add all documents
      const ids = await Promise.all(
        documents.map(text => searchManager.addDocument(text))
      );

      expect(ids).toHaveLength(20);
      expect(await searchManager.size()).toBe(20);

      // Search should work
      const results = await searchManager.search('content', 10);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('configuration', () => {
    it('should use custom embedding engine', async () => {
      const customManager = new VectorSearchManager({
        embeddingEngine: new MockEmbeddingEngine(50),
        indexConfig: {
          useIndexedDB: false,
        },
      });

      const id = await customManager.addDocument('Test with custom engine');
      expect(id).toBeDefined();

      const results = await customManager.search('Test', 1);
      expect(results.length).toBeGreaterThan(0);

      await customManager.contentStore.delete();
    });

    it('should respect distance function configuration', async () => {
      const cosineManager = new VectorSearchManager({
        embeddingEngine: new SimpleMockEmbedding(10),
        indexConfig: {
          distanceFunction: 'cosine',
          useIndexedDB: false,
        },
      });

      await cosineManager.addDocument('Test document');
      const results = await cosineManager.search('Test', 1);

      expect(results[0].distance).toBeGreaterThanOrEqual(0);
      
      await cosineManager.contentStore.delete();
    });
  });

  describe('edge cases', () => {
    it('should handle duplicate text with different IDs', async () => {
      const text = 'Same content';
      const id1 = await searchManager.addDocument(text, 'id1');
      const id2 = await searchManager.addDocument(text, 'id2');

      expect(id1).not.toBe(id2);
      expect(await searchManager.size()).toBe(2);
    });

    it('should handle concurrent additions', async () => {
      const promises = Array(10).fill(0).map((_, i) =>
        searchManager.addDocument(`Concurrent doc ${i}`)
      );

      const ids = await Promise.all(promises);
      
      expect(ids).toHaveLength(10);
      expect(new Set(ids).size).toBe(10); // All unique
      expect(await searchManager.size()).toBe(10);
    });

    it('should handle very similar documents', async () => {
      await searchManager.addDocument('The cat sat on the mat');
      await searchManager.addDocument('The cat sat on the mat.');
      await searchManager.addDocument('The cat sat on a mat');

      const results = await searchManager.search('cat mat', 3);
      expect(results.length).toBe(3);
    });
  });

  describe('direct ContentStore access', () => {
    it('should allow direct access to ContentStore', async () => {
      const id = await searchManager.addDocument('Direct access test');

      // Access via public contentStore property
      const doc = await searchManager.contentStore.documents.get(id);
      expect(doc?.text).toBe('Direct access test');
    });

    it('should allow querying all stored documents', async () => {
      await searchManager.addDocument('Doc 1');
      await searchManager.addDocument('Doc 2');
      await searchManager.addDocument('Doc 3');

      const allDocs = await searchManager.contentStore.documents.toArray();
      expect(allDocs).toHaveLength(3);
    });
  });
});
