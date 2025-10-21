// ContentStore.crud.test.ts - Tests for ContentStore CRUD operations
import { ContentStore } from '../embeddings/ContentStore';

describe('ContentStore CRUD Operations', () => {
  let store: ContentStore;

  beforeEach(async () => {
    store = new ContentStore();
    await store.clear();
  });

  afterEach(async () => {
    await store.clear();
    await store.close();
  });

  describe('addDocument', () => {
    it('should add a document', async () => {
      const id = await store.addDocument('test-id', 'Test content');
      expect(id).toBe('test-id');
      
      const doc = await store.getDocument('test-id');
      expect(doc?.text).toBe('Test content');
    });

    it('should handle multiple documents', async () => {
      await store.addDocument('id1', 'Content 1');
      await store.addDocument('id2', 'Content 2');
      await store.addDocument('id3', 'Content 3');
      
      const count = await store.count();
      expect(count).toBe(3);
    });
  });

  describe('updateDocument', () => {
    it('should update existing document', async () => {
      await store.addDocument('test-id', 'Original content');
      await store.updateDocument('test-id', 'Updated content');
      
      const doc = await store.getDocument('test-id');
      expect(doc?.text).toBe('Updated content');
      
      // Should still be only one document
      const count = await store.count();
      expect(count).toBe(1);
    });

    it('should create document if it does not exist', async () => {
      await store.updateDocument('new-id', 'New content');
      
      const doc = await store.getDocument('new-id');
      expect(doc?.text).toBe('New content');
    });
  });

  describe('deleteDocument', () => {
    it('should delete a document', async () => {
      await store.addDocument('test-id', 'Test content');
      await store.deleteDocument('test-id');
      
      const doc = await store.getDocument('test-id');
      expect(doc).toBeUndefined();
    });

    it('should not throw error when deleting non-existent document', async () => {
      await expect(store.deleteDocument('non-existent')).resolves.not.toThrow();
    });

    it('should reduce count after deletion', async () => {
      await store.addDocument('id1', 'Content 1');
      await store.addDocument('id2', 'Content 2');
      
      let count = await store.count();
      expect(count).toBe(2);
      
      await store.deleteDocument('id1');
      
      count = await store.count();
      expect(count).toBe(1);
    });
  });

  describe('getDocument', () => {
    it('should retrieve a single document', async () => {
      await store.addDocument('test-id', 'Test content');
      
      const doc = await store.getDocument('test-id');
      expect(doc).toBeDefined();
      expect(doc?.id).toBe('test-id');
      expect(doc?.text).toBe('Test content');
    });

    it('should return undefined for non-existent document', async () => {
      const doc = await store.getDocument('non-existent');
      expect(doc).toBeUndefined();
    });
  });

  describe('getDocuments', () => {
    it('should retrieve multiple documents', async () => {
      await store.addDocument('id1', 'Content 1');
      await store.addDocument('id2', 'Content 2');
      await store.addDocument('id3', 'Content 3');
      
      const docs = await store.getDocuments(['id1', 'id2', 'id3']);
      expect(docs).toHaveLength(3);
      expect(docs[0]?.text).toBe('Content 1');
      expect(docs[1]?.text).toBe('Content 2');
      expect(docs[2]?.text).toBe('Content 3');
    });

    it('should handle missing documents in batch', async () => {
      await store.addDocument('id1', 'Content 1');
      await store.addDocument('id3', 'Content 3');
      
      const docs = await store.getDocuments(['id1', 'id2', 'id3']);
      expect(docs).toHaveLength(3);
      expect(docs[0]?.text).toBe('Content 1');
      expect(docs[1]).toBeUndefined();
      expect(docs[2]?.text).toBe('Content 3');
    });

    it('should handle empty array', async () => {
      const docs = await store.getDocuments([]);
      expect(docs).toHaveLength(0);
    });
  });

  describe('getAllDocuments', () => {
    it('should retrieve all documents', async () => {
      await store.addDocument('id1', 'Content 1');
      await store.addDocument('id2', 'Content 2');
      await store.addDocument('id3', 'Content 3');
      
      const docs = await store.getAllDocuments();
      expect(docs).toHaveLength(3);
      expect(docs.map(d => d.id)).toContain('id1');
      expect(docs.map(d => d.id)).toContain('id2');
      expect(docs.map(d => d.id)).toContain('id3');
    });

    it('should return empty array for empty store', async () => {
      const docs = await store.getAllDocuments();
      expect(docs).toHaveLength(0);
    });
  });

  describe('count', () => {
    it('should return correct count', async () => {
      expect(await store.count()).toBe(0);
      
      await store.addDocument('id1', 'Content 1');
      expect(await store.count()).toBe(1);
      
      await store.addDocument('id2', 'Content 2');
      expect(await store.count()).toBe(2);
      
      await store.deleteDocument('id1');
      expect(await store.count()).toBe(1);
    });
  });

  describe('clear', () => {
    it('should remove all documents', async () => {
      await store.addDocument('id1', 'Content 1');
      await store.addDocument('id2', 'Content 2');
      await store.addDocument('id3', 'Content 3');
      
      expect(await store.count()).toBe(3);
      
      await store.clear();
      
      expect(await store.count()).toBe(0);
    });

    it('should allow adding after clear', async () => {
      await store.addDocument('id1', 'Content 1');
      await store.clear();
      await store.addDocument('id2', 'Content 2');
      
      expect(await store.count()).toBe(1);
      const doc = await store.getDocument('id2');
      expect(doc?.text).toBe('Content 2');
    });
  });

  describe('Complex workflows', () => {
    it('should handle mixed CRUD operations', async () => {
      // Add
      await store.addDocument('doc1', 'Version 1');
      await store.addDocument('doc2', 'Document 2');
      await store.addDocument('doc3', 'Document 3');
      
      // Update
      await store.updateDocument('doc1', 'Version 2');
      
      // Delete
      await store.deleteDocument('doc2');
      
      // Verify
      const doc1 = await store.getDocument('doc1');
      expect(doc1?.text).toBe('Version 2');
      
      const doc2 = await store.getDocument('doc2');
      expect(doc2).toBeUndefined();
      
      const doc3 = await store.getDocument('doc3');
      expect(doc3?.text).toBe('Document 3');
      
      expect(await store.count()).toBe(2);
    });

    it('should handle large batch operations', async () => {
      const batchSize = 100;
      
      // Add many documents
      for (let i = 0; i < batchSize; i++) {
        await store.addDocument(`doc${i}`, `Content ${i}`);
      }
      
      expect(await store.count()).toBe(batchSize);
      
      // Update half
      for (let i = 0; i < batchSize / 2; i++) {
        await store.updateDocument(`doc${i}`, `Updated ${i}`);
      }
      
      // Delete quarter
      for (let i = 0; i < batchSize / 4; i++) {
        await store.deleteDocument(`doc${i}`);
      }
      
      const finalCount = await store.count();
      expect(finalCount).toBe(batchSize - batchSize / 4);
    });
  });
});
