/**
 * ContentStore Tests
 * Tests for the IndexedDB-based content storage system
 */
import { describe, it, expect, afterEach, beforeEach } from '@jest/globals';
import { ContentStore, IDocument } from '../embeddings/ContentStore';

describe('ContentStore', () => {
  let store: ContentStore;

  beforeEach(async () => {
    // Create a fresh store for each test
    store = new ContentStore();
    await store.documents.clear();
  });

  afterEach(async () => {
    // Clean up
    await store.delete();
  });

  describe('addDocument', () => {
    it('should add a document with an ID and text', async () => {
      const id = 'test-doc-1';
      const text = 'This is a test document';

      const result = await store.addDocument(id, text);

      expect(result).toBe(id);
      const doc = await store.documents.get(id);
      expect(doc).toBeDefined();
      expect(doc?.id).toBe(id);
      expect(doc?.text).toBe(text);
    });

    it('should update an existing document if ID already exists', async () => {
      const id = 'test-doc-1';
      const text1 = 'Original text';
      const text2 = 'Updated text';

      await store.addDocument(id, text1);
      await store.addDocument(id, text2);

      const doc = await store.documents.get(id);
      expect(doc?.text).toBe(text2);
    });

    it('should handle multiple documents', async () => {
      await store.addDocument('doc1', 'First document');
      await store.addDocument('doc2', 'Second document');
      await store.addDocument('doc3', 'Third document');

      const count = await store.documents.count();
      expect(count).toBe(3);
    });

    it('should handle empty text', async () => {
      const id = 'empty-doc';
      const result = await store.addDocument(id, '');

      expect(result).toBe(id);
      const doc = await store.documents.get(id);
      expect(doc?.text).toBe('');
    });

    it('should handle long text', async () => {
      const id = 'long-doc';
      const longText = 'A'.repeat(10000);

      await store.addDocument(id, longText);
      const doc = await store.documents.get(id);
      expect(doc?.text.length).toBe(10000);
    });
  });

  describe('getDocuments', () => {
    beforeEach(async () => {
      await store.addDocument('doc1', 'First document');
      await store.addDocument('doc2', 'Second document');
      await store.addDocument('doc3', 'Third document');
    });

    it('should retrieve multiple documents by IDs', async () => {
      const docs = await store.getDocuments(['doc1', 'doc3']);

      expect(docs).toHaveLength(2);
      expect(docs[0]?.id).toBe('doc1');
      expect(docs[0]?.text).toBe('First document');
      expect(docs[1]?.id).toBe('doc3');
      expect(docs[1]?.text).toBe('Third document');
    });

    it('should return undefined for non-existent IDs', async () => {
      const docs = await store.getDocuments(['doc1', 'nonexistent', 'doc2']);

      expect(docs).toHaveLength(3);
      expect(docs[0]?.id).toBe('doc1');
      expect(docs[1]).toBeUndefined();
      expect(docs[2]?.id).toBe('doc2');
    });

    it('should handle empty array', async () => {
      const docs = await store.getDocuments([]);
      expect(docs).toHaveLength(0);
    });

    it('should maintain order of requested IDs', async () => {
      const docs = await store.getDocuments(['doc3', 'doc1', 'doc2']);

      expect(docs[0]?.id).toBe('doc3');
      expect(docs[1]?.id).toBe('doc1');
      expect(docs[2]?.id).toBe('doc2');
    });
  });

  describe('database operations', () => {
    it('should persist data across instances', async () => {
      await store.addDocument('persist-test', 'Persistent data');

      // Create a new instance with the same database name
      const store2 = new ContentStore();
      const doc = await store2.documents.get('persist-test');

      expect(doc?.text).toBe('Persistent data');
      await store2.delete();
    });

    it('should handle concurrent writes', async () => {
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(store.addDocument(`doc${i}`, `Document ${i}`));
      }

      await Promise.all(promises);
      const count = await store.documents.count();
      expect(count).toBe(10);
    });

    it('should support querying all documents', async () => {
      await store.addDocument('doc1', 'First');
      await store.addDocument('doc2', 'Second');
      await store.addDocument('doc3', 'Third');

      const allDocs = await store.documents.toArray();
      expect(allDocs).toHaveLength(3);
    });

    it('should support deleting documents', async () => {
      await store.addDocument('doc-to-delete', 'Will be deleted');
      await store.documents.delete('doc-to-delete');

      const doc = await store.documents.get('doc-to-delete');
      expect(doc).toBeUndefined();
    });

    it('should support clearing all documents', async () => {
      await store.addDocument('doc1', 'First');
      await store.addDocument('doc2', 'Second');

      await store.documents.clear();
      const count = await store.documents.count();
      expect(count).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle special characters in text', async () => {
      const specialText = '🚀 Unicode: émojis & spëcial chàrs! @#$%^&*()';
      await store.addDocument('special', specialText);

      const doc = await store.documents.get('special');
      expect(doc?.text).toBe(specialText);
    });

    it('should handle special characters in IDs', async () => {
      const specialId = 'doc-with_special.chars@123';
      await store.addDocument(specialId, 'Text content');

      const doc = await store.documents.get(specialId);
      expect(doc?.id).toBe(specialId);
    });

    it('should handle very long IDs', async () => {
      const longId = 'x'.repeat(1000);
      await store.addDocument(longId, 'Content');

      const doc = await store.documents.get(longId);
      expect(doc?.id).toBe(longId);
    });
  });
});
