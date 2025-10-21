/**
 * Phase 1: Ready Pattern & Race Condition Fix Tests
 * 
 * Tests the async initialization pattern that fixes the race condition bug
 * where NodesInIndexedDB.graphLayers holds a stale reference to an empty array.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import Dexie from 'dexie';
import { HNSW } from '../mememo/src/mememo';

// Mock d3-random for deterministic tests
jest.mock('d3-random', () => ({
  randomLcg: () => () => 0.5,
  randomUniform: () => () => 0.5
}));

describe('Phase 1: Ready Pattern & Race Condition Fix', () => {
  let db: Dexie;

  beforeEach(async () => {
    // Clear IndexedDB before each test
    db = new Dexie('mememo-index-store');
    db.version(1).stores({
      mememo: 'key',
      indexMetadata: 'id'
    });
    await db.table('mememo').clear();
    await db.table('indexMetadata').clear();
  });

  afterEach(async () => {
    if (db) {
      await db.delete();
    }
  });

  describe('ready() method', () => {
    it('should resolve immediately when clearOnInit=true', async () => {
      const index = new HNSW({
        useIndexedDB: true,
        clearOnInit: true,
        m: 4
      });

      const startTime = Date.now();
      await index.ready();
      const elapsed = Date.now() - startTime;

      // Should be instant (< 10ms)
      expect(elapsed).toBeLessThan(10);
    });

    it('should resolve immediately when using in-memory mode', async () => {
      const index = new HNSW({
        useIndexedDB: false,
        m: 4
      });

      const startTime = Date.now();
      await index.ready();
      const elapsed = Date.now() - startTime;

      // Should be instant (< 10ms)
      expect(elapsed).toBeLessThan(10);
    });

    it('should wait for persistence loading when clearOnInit=false', async () => {
      // First, create and save an index
      const index1 = new HNSW({
        useIndexedDB: true,
        clearOnInit: true,
        m: 4
      });

      await index1.insert('key1', [1, 0, 0]);
      await index1.insert('key2', [0, 1, 0]);
      await index1.saveIndex();

      // Create new instance that will load from persistence
      const index2 = new HNSW({
        useIndexedDB: true,
        clearOnInit: false,
        m: 4
      });

      // ready() should wait for load to complete
      await index2.ready();

      // After ready(), graph should be loaded
      expect(index2.graphLayers.length).toBeGreaterThan(0);
      expect(index2.entryPointKey).not.toBeNull();
    });

    it('should be idempotent - multiple calls are safe', async () => {
      const index = new HNSW({
        useIndexedDB: true,
        clearOnInit: true,
        m: 4
      });

      await index.ready();
      await index.ready();
      await index.ready();

      // Should not throw or cause issues
      expect(index).toBeDefined();
    });
  });

  describe('Race condition fix: NodesInIndexedDB.graphLayers reference', () => {
    it('should fix stale graphLayers reference after load', async () => {
      // Step 1: Create index with data
      const index1 = new HNSW({
        useIndexedDB: true,
        clearOnInit: true,
        m: 4
      });

      await index1.insert('doc1', [1, 0, 0, 0]);
      await index1.insert('doc2', [0, 1, 0, 0]);
      await index1.insert('doc3', [0, 0, 1, 0]);
      await index1.saveIndex();

      // Step 2: Create new instance (simulates page reload)
      const index2 = new HNSW({
        useIndexedDB: true,
        clearOnInit: false, // Will load persisted data
        m: 4
      });

      // Step 3: Wait for initialization
      await index2.ready();

      // Step 4: Verify NodesInIndexedDB has correct reference
      expect(index2.graphLayers.length).toBeGreaterThan(0);
      
      // This is the critical check: nodes should reference the LOADED graphLayers
      if ('graphLayers' in index2.nodes) {
        const nodesIndexedDB = index2.nodes as any;
        expect(nodesIndexedDB.graphLayers).toBe(index2.graphLayers);
        expect(nodesIndexedDB.graphLayers.length).toBe(index2.graphLayers.length);
        expect(nodesIndexedDB.graphLayers[0]).toBeDefined();
      }

      // Step 5: Query should work without crashing (the original bug)
      const result = await index2.query([1, 0, 0, 0], 2);
      expect(result.keys).toContain('doc1');
    });

    it('should not crash on query after reload', async () => {
      // This test reproduces the original bug scenario

      // Setup: Create and save index
      const index1 = new HNSW({
        useIndexedDB: true,
        clearOnInit: true,
        m: 4
      });

      await index1.insert('sock.txt_chunk_0', [0.1, 0.2, 0.3, 0.4]);
      await index1.insert('sock.txt_chunk_1', [0.2, 0.3, 0.4, 0.5]);
      await index1.saveIndex();

      // Reload: Create new instance
      const index2 = new HNSW({
        useIndexedDB: true,
        clearOnInit: false,
        m: 4
      });

      await index2.ready();

      // This used to crash with: "Cannot read properties of undefined (reading 'graph')"
      // at NodesInIndexedDB._prefetch because graphLayers[level] was undefined
      await expect(index2.query([0.1, 0.2, 0.3, 0.4], 1)).resolves.toBeDefined();
    });

    it('should allow insert after reload without crashing', async () => {
      // Setup
      const index1 = new HNSW({
        useIndexedDB: true,
        clearOnInit: true,
        m: 4
      });

      await index1.insert('doc1', [1, 0, 0, 0]);
      await index1.saveIndex();

      // Reload
      const index2 = new HNSW({
        useIndexedDB: true,
        clearOnInit: false,
        m: 4
      });

      await index2.ready();

      // Insert should work (used to crash during _insertToGraph)
      await expect(index2.insert('doc2', [0, 1, 0, 0])).resolves.not.toThrow();
      
      // Verify both docs are accessible
      const result = await index2.query([1, 0, 0, 0], 2);
      expect(result.keys).toHaveLength(2);
    });
  });

  describe('Operation guards: ready() blocking', () => {
    it('should block insert() until initialization complete', async () => {
      // Create index with persisted data
      const index1 = new HNSW({
        useIndexedDB: true,
        clearOnInit: true,
        m: 4
      });
      await index1.insert('existing', [1, 0, 0, 0]);
      await index1.saveIndex();

      // Create new instance that will load async
      const index2 = new HNSW({
        useIndexedDB: true,
        clearOnInit: false,
        m: 4
      });

      // Don't call ready() - insert should call it internally
      const insertPromise = index2.insert('new', [0, 1, 0, 0]);

      // Should not throw
      await expect(insertPromise).resolves.not.toThrow();
      
      // Should have loaded existing data
      expect(index2.entryPointKey).not.toBeNull();
    });

    it('should block query() until initialization complete', async () => {
      // Setup
      const index1 = new HNSW({
        useIndexedDB: true,
        clearOnInit: true,
        m: 4
      });
      await index1.insert('doc1', [1, 0, 0, 0]);
      await index1.saveIndex();

      // Reload
      const index2 = new HNSW({
        useIndexedDB: true,
        clearOnInit: false,
        m: 4
      });

      // Query immediately without calling ready() manually
      const result = await index2.query([1, 0, 0, 0], 1);

      // Should return the persisted data
      expect(result.keys).toContain('doc1');
    });

    it('should block update() until initialization complete', async () => {
      // Setup
      const index1 = new HNSW({
        useIndexedDB: true,
        clearOnInit: true,
        m: 4
      });
      await index1.insert('doc1', [1, 0, 0, 0]);
      await index1.saveIndex();

      // Reload
      const index2 = new HNSW({
        useIndexedDB: true,
        clearOnInit: false,
        m: 4
      });

      // Update without calling ready() first
      await expect(index2.update('doc1', [0.9, 0.1, 0, 0])).resolves.not.toThrow();
    });

    it('should block bulkInsert() until initialization complete', async () => {
      // Setup
      const index1 = new HNSW({
        useIndexedDB: true,
        clearOnInit: true,
        m: 4
      });
      await index1.insert('doc1', [1, 0, 0, 0]);
      await index1.saveIndex();

      // Reload
      const index2 = new HNSW({
        useIndexedDB: true,
        clearOnInit: false,
        m: 4
      });

      // BulkInsert without calling ready() first
      await expect(
        index2.bulkInsert(['doc2', 'doc3'], [[0, 1, 0, 0], [0, 0, 1, 0]])
      ).resolves.not.toThrow();

      // Should have all docs
      const result = await index2.query([1, 0, 0, 0], 3);
      expect(result.keys).toHaveLength(3);
    });
  });

  describe('Concurrent operations during initialization', () => {
    it('should handle multiple operations fired before ready() completes', async () => {
      // Setup
      const index1 = new HNSW({
        useIndexedDB: true,
        clearOnInit: true,
        m: 4
      });
      await index1.insert('doc1', [1, 0, 0, 0]);
      await index1.saveIndex();

      // Reload
      const index2 = new HNSW({
        useIndexedDB: true,
        clearOnInit: false,
        m: 4
      });

      // Fire multiple operations immediately (all will wait for ready())
      const promises = [
        index2.insert('doc2', [0, 1, 0, 0]),
        index2.query([1, 0, 0, 0], 1),
        index2.insert('doc3', [0, 0, 1, 0])
      ];

      // All should complete without error
      await expect(Promise.all(promises)).resolves.toBeDefined();

      // Verify all operations succeeded
      const finalResult = await index2.query([0, 0, 0, 0], 10);
      expect(finalResult.keys).toContain('doc1');
      expect(finalResult.keys).toContain('doc2');
      expect(finalResult.keys).toContain('doc3');
    });
  });

  describe('Error handling', () => {
    it('should handle corrupted IndexedDB data gracefully', async () => {
      // Write invalid data to IndexedDB
      const metadataTable = db.table('indexMetadata');
      await metadataTable.put({ 
        id: 'graph', 
        data: { 
          distanceFunctionType: 'cosine',
          m: 4,
          efConstruction: 100,
          invalid: 'structure' // Missing graphLayers field
        } 
      });

      // Try to load
      const index = new HNSW({
        useIndexedDB: true,
        clearOnInit: false,
        m: 4
      });

      await index.ready();

      // Should not crash, but should start with empty index
      expect(index.graphLayers.length).toBe(0);
      // entryPointKey should be null or undefined after failed load
      expect(index.entryPointKey == null).toBe(true);
    });

    it('should work normally after failed initialization', async () => {
      // Create index that fails to load
      const metadataTable = db.table('indexMetadata');
      await metadataTable.put({ id: 'graph', data: null });

      const index = new HNSW({
        useIndexedDB: true,
        clearOnInit: false,
        m: 4
      });

      await index.ready();

      // Should still be able to use the index
      await expect(index.insert('doc1', [1, 0, 0, 0])).resolves.not.toThrow();
      
      const result = await index.query([1, 0, 0, 0], 1);
      expect(result.keys).toContain('doc1');
    });
  });

  describe('Performance: ready() overhead', () => {
    it('should have minimal overhead for empty index', async () => {
      const index = new HNSW({
        useIndexedDB: true,
        clearOnInit: false,
        m: 4
      });

      const startTime = Date.now();
      await index.ready();
      const elapsed = Date.now() - startTime;

      // Should complete in < 100ms for empty index
      expect(elapsed).toBeLessThan(100);
    });

    it('should load 100-node index in reasonable time', async () => {
      // Setup: Create index with 100 nodes
      const index1 = new HNSW({
        useIndexedDB: true,
        clearOnInit: true,
        m: 4
      });

      const insertions = [];
      for (let i = 0; i < 100; i++) {
        const vec = Array(16).fill(0);
        vec[i % 16] = 1;
        insertions.push(index1.insert(`doc${i}`, vec));
      }
      await Promise.all(insertions);
      await index1.saveIndex();

      // Reload and measure
      const index2 = new HNSW({
        useIndexedDB: true,
        clearOnInit: false,
        m: 4
      });

      const startTime = Date.now();
      await index2.ready();
      const elapsed = Date.now() - startTime;

      // Should load in < 500ms
      expect(elapsed).toBeLessThan(500);
      expect(index2.graphLayers.length).toBeGreaterThan(0);
    });
  });
});
