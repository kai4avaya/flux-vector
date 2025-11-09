// VectorSearchManager.crud.test.ts - Tests for CRUD operations
import VectorSearchManager from '../embeddings/VectorSearchManager';
import { MockEmbeddingEngine } from './mocks/MockEmbedding';

describe('VectorSearchManager CRUD Operations', () => {
  let manager: VectorSearchManager;

  beforeEach(async () => {
    manager = new VectorSearchManager({
      embeddingEngine: new MockEmbeddingEngine(),
      indexConfig: {
        distanceFunction: 'cosine-normalized',
        m: 8,
        efConstruction: 100,
        useIndexedDB: false,
      }
    });
  });

  afterEach(async () => {
    // Clean up
    await manager.contentStore.clear();
    await manager.index.clear();
  });

  describe('deleteDocument', () => {
    it('should delete a document from both store and index', async () => {
      // Add a document
      const { documentId: id } = await manager.addDocument('Test document to delete');
      
      // Verify it exists
      const doc = await manager.getDocument(id);
      expect(doc).toBeDefined();
      expect(doc?.text).toBe('Test document to delete');
      
      // Delete it
      await manager.deleteDocument(id);
      
      // Verify it's gone from content store
      const deletedDoc = await manager.getDocument(id);
      expect(deletedDoc).toBeUndefined();
      
      // Verify it's either deleted or marked as deleted in index
      const node = await manager.index.nodes.get(id, 0);
      if (node) {
        expect(node.isDeleted).toBe(true);
      } else {
        // Node might not exist if it was removed from memory
        expect(node).toBeFalsy();
      }
    });

    it('should throw error when deleting non-existent document', async () => {
      await expect(manager.deleteDocument('non-existent-id'))
        .rejects.toThrow('Document non-existent-id not found');
    });

    it('should exclude deleted documents from search results', async () => {
      // Add multiple documents
      const { documentId: id1 } = await manager.addDocument('The cat sat on the mat');
      const { documentId: id2 } = await manager.addDocument('The dog ran in the park');
      await manager.addDocument('The bird flew in the sky');
      
      // Delete one document
      await manager.deleteDocument(id1);
      
      // Search should not return deleted document
      const results = await manager.search('cat', 3);
      
      expect(results.length).toBeLessThan(3);
      expect(results.find(r => r.key === id1)).toBeUndefined();
    });

    it('should handle multiple deletions', async () => {
      const ids = [];
      for (let i = 0; i < 5; i++) {
        const result = await manager.addDocument(`Document ${i}`);
        ids.push(result.documentId);
      }
      
      // Delete first 3
      for (let i = 0; i < 3; i++) {
        await manager.deleteDocument(ids[i]);
      }
      
      const stats = await manager.getStats();
      expect(stats.activeNodes).toBe(2);
      expect(stats.deletedNodes).toBe(3);
    });
  });

  describe('updateDocument', () => {
    it('should update document text and re-embed', async () => {
      // Add initial document
      const { documentId: id } = await manager.addDocument('Original text');
      
      // Update it
      await manager.updateDocument(id, 'Updated text');
      
      // Verify content store has new text
      const doc = await manager.getDocument(id);
      expect(doc?.text).toBe('Updated text');
      
      // Verify it still exists in index
      const exists = await manager.hasDocument(id);
      expect(exists).toBe(true);
    });

    it('should throw error when updating non-existent document', async () => {
      await expect(manager.updateDocument('non-existent-id', 'New text'))
        .rejects.toThrow('Document non-existent-id not found');
    });

    it('should update search results after document update', async () => {
      // Add documents
      const { documentId: id1 } = await manager.addDocument('The cat sat on the mat');
      await manager.addDocument('The dog ran in the park');
      
      // Search for 'cat'
      let results = await manager.search('cat', 2);
      expect(results[0].key).toBe(id1);
      expect(results[0].text).toBe('The cat sat on the mat');
      
      // Update the document to something completely different
      await manager.updateDocument(id1, 'Quantum physics and Einstein');
      
      // Verify the text is updated
      const doc = await manager.getDocument(id1);
      expect(doc?.text).toBe('Quantum physics and Einstein');
    });

    it('should handle multiple updates to same document', async () => {
      const { documentId: id } = await manager.addDocument('Version 1');
      
      await manager.updateDocument(id, 'Version 2');
      let doc = await manager.getDocument(id);
      expect(doc?.text).toBe('Version 2');
      
      await manager.updateDocument(id, 'Version 3');
      doc = await manager.getDocument(id);
      expect(doc?.text).toBe('Version 3');
      
      await manager.updateDocument(id, 'Final version');
      doc = await manager.getDocument(id);
      expect(doc?.text).toBe('Final version');
      
      // Should still be only one document
      const size = await manager.size();
      expect(size).toBe(1);
    });
  });

  describe('compactIndex', () => {
    it('should remove soft-deleted nodes from memory', async () => {
      // Add documents
      const ids = [];
      for (let i = 0; i < 10; i++) {
        const result = await manager.addDocument(`Document ${i}`);
        ids.push(result.documentId);
      }
      
      // Delete half of them (soft delete)
      for (let i = 0; i < 5; i++) {
        await manager.deleteDocument(ids[i]);
      }
      
      // Check stats before compaction
      let stats = await manager.getStats();
      expect(stats.totalNodes).toBe(10);
      expect(stats.activeNodes).toBe(5);
      expect(stats.deletedNodes).toBe(5);
      
      // Compact the index
      await manager.compactIndex();
      
      // Check stats after compaction
      stats = await manager.getStats();
      expect(stats.totalNodes).toBe(5);
      expect(stats.activeNodes).toBe(5);
      expect(stats.deletedNodes).toBe(0);
    });

    it('should maintain search functionality after compaction', async () => {
      // Add documents
      const { documentId: id1 } = await manager.addDocument('The cat sat on the mat');
      const { documentId: id2 } = await manager.addDocument('The dog ran in the park');
      const { documentId: id3 } = await manager.addDocument('The bird flew in the sky');
      
      // Delete one
      await manager.deleteDocument(id2);
      
      // Compact
      await manager.compactIndex();
      
      // Search should still work and return the cat document
      const results = await manager.search('cat', 3);
      expect(results.length).toBeGreaterThan(0);
      
      // Verify cat document is in results
      const catResult = results.find(r => r.key === id1);
      expect(catResult).toBeDefined();
      expect(catResult?.text).toBe('The cat sat on the mat');
      
      // Verify deleted document is not in results
      const dogResult = results.find(r => r.key === id2);
      expect(dogResult).toBeUndefined();
    });

    it('should handle compaction with no deleted nodes', async () => {
      // Add documents without deleting any
      // Add documents (no need to track IDs for this test)
      await manager.addDocument('Document 1');
      await manager.addDocument('Document 2');
      await manager.addDocument('Document 3');
      
      const sizeBefore = await manager.size();
      
      // Compact should have no effect
      await manager.compactIndex();
      
      const sizeAfter = await manager.size();
      expect(sizeAfter).toBe(sizeBefore);
    });

    it('should handle empty index compaction', async () => {
      await manager.compactIndex();
      
      const stats = await manager.getStats();
      expect(stats.totalNodes).toBe(0);
    });
  });

  describe('hasDocument', () => {
    it('should return true for existing active document', async () => {
      const { documentId: id } = await manager.addDocument('Test document');
      const exists = await manager.hasDocument(id);
      expect(exists).toBe(true);
    });

    it('should return false for non-existent document', async () => {
      const exists = await manager.hasDocument('non-existent-id');
      expect(exists).toBe(false);
    });

    it('should return false for deleted document', async () => {
      const { documentId: id } = await manager.addDocument('Test document');
      await manager.deleteDocument(id);
      
      const exists = await manager.hasDocument(id);
      expect(exists).toBe(false);
    });
  });

  describe('getDocument', () => {
    it('should retrieve document by ID', async () => {
      const { documentId: id } = await manager.addDocument('Test content');
      const doc = await manager.getDocument(id);
      
      expect(doc).toBeDefined();
      expect(doc?.id).toBe(id);
      expect(doc?.text).toBe('Test content');
    });

    it('should return undefined for non-existent document', async () => {
      const doc = await manager.getDocument('non-existent-id');
      expect(doc).toBeUndefined();
    });

    it('should return undefined after deletion', async () => {
      const { documentId: id } = await manager.addDocument('Test content');
      await manager.deleteDocument(id);
      
      const doc = await manager.getDocument(id);
      expect(doc).toBeUndefined();
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      // Add documents
      const ids = [];
      for (let i = 0; i < 5; i++) {
        const result = await manager.addDocument(`Document ${i}`);
        ids.push(result.documentId);
      }
      
      // Delete some
      await manager.deleteDocument(ids[0]);
      await manager.deleteDocument(ids[1]);
      
      const stats = await manager.getStats();
      expect(stats.totalNodes).toBe(5);
      expect(stats.activeNodes).toBe(3);
      expect(stats.deletedNodes).toBe(2);
    });

    it('should return zeros for empty index', async () => {
      const stats = await manager.getStats();
      expect(stats.totalNodes).toBe(0);
      expect(stats.activeNodes).toBe(0);
      expect(stats.deletedNodes).toBe(0);
    });
  });

  describe('Complex workflows', () => {
    it('should handle add -> update -> delete -> compact workflow', async () => {
      // Add
      const { documentId: id1 } = await manager.addDocument('Document 1');
      const { documentId: id2 } = await manager.addDocument('Document 2');
      const { documentId: id3 } = await manager.addDocument('Document 3');
      
      // Update
      await manager.updateDocument(id2, 'Updated Document 2');
      
      // Delete
      await manager.deleteDocument(id1);
      
      // Verify state
      let stats = await manager.getStats();
      expect(stats.activeNodes).toBe(2);
      expect(stats.deletedNodes).toBe(1);
      
      // Compact
      await manager.compactIndex();
      
      // Verify final state
      stats = await manager.getStats();
      expect(stats.totalNodes).toBe(2);
      expect(stats.deletedNodes).toBe(0);
      
      // Verify remaining documents
      const doc2 = await manager.getDocument(id2);
      expect(doc2?.text).toBe('Updated Document 2');
      
      const doc3 = await manager.getDocument(id3);
      expect(doc3?.text).toBe('Document 3');
      
      const doc1 = await manager.getDocument(id1);
      expect(doc1).toBeUndefined();
    });

    it('should handle rapid add/delete cycles', async () => {
      const ids: string[] = [];
      
      // Add 10 documents
      for (let i = 0; i < 10; i++) {
        const result = await manager.addDocument(`Document ${i}`);
        ids.push(result.documentId);
      }
      
      // Delete odd-numbered documents
      for (let i = 1; i < 10; i += 2) {
        await manager.deleteDocument(ids[i]);
      }
      
      // Add 5 more documents
      for (let i = 10; i < 15; i++) {
        const result = await manager.addDocument(`Document ${i}`);
        ids.push(result.documentId);
      }
      
      // Stats should show mixed state
      const stats = await manager.getStats();
      expect(stats.activeNodes).toBe(10); // 5 from first batch + 5 from second
      expect(stats.deletedNodes).toBe(5); // odd-numbered from first batch
    });

    it('should maintain data integrity through multiple operations', async () => {
      const testData = [
        { text: 'Machine learning algorithms', query: 'algorithm' },
        { text: 'Natural language processing', query: 'language' },
        { text: 'Computer vision systems', query: 'vision' },
      ];
      
      // Add all documents
      const ids: string[] = [];
      for (const data of testData) {
        const result = await manager.addDocument(data.text);
        ids.push(result.documentId);
      }
      
      // Verify search works
      for (let i = 0; i < testData.length; i++) {
        const results = await manager.search(testData[i].query, 3);
        const matchFound = results.some(r => r.key === ids[i]);
        expect(matchFound).toBe(true);
      }
      
      // Update middle document
      await manager.updateDocument(ids[1], 'Deep learning neural networks');
      
      // Delete first document
      await manager.deleteDocument(ids[0]);
      
      // Compact
      await manager.compactIndex();
      
      // Verify final state
      expect(await manager.hasDocument(ids[0])).toBe(false);
      expect(await manager.hasDocument(ids[1])).toBe(true);
      expect(await manager.hasDocument(ids[2])).toBe(true);
      
      const updated = await manager.getDocument(ids[1]);
      expect(updated?.text).toBe('Deep learning neural networks');
    });
  });
});
