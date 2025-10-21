import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import Dexie from 'dexie';
import { HNSW } from '../mememo/src/mememo';

// Mock d3-random for deterministic tests
jest.mock('d3-random', () => ({
  randomLcg: () => () => 0.5,
  randomUniform: () => () => 0.5
}));

describe('Mememo Serialization and Index Reuse', () => {
  let db: Dexie;

  beforeEach(async () => {
    // Clean up any existing database
    db = new Dexie('mememo-index-store');
    await db.delete();
  });

  afterEach(async () => {
    // Clean up after each test
    await db.delete();
  });

  describe('Index Persistence and Reload', () => {
    test('should save and load index with correct graph structure', async () => {
      // Create initial index with some data
      const hnsw1 = new HNSW({
        distanceFunction: 'cosine-normalized',
        m: 4,
        efConstruction: 10,
        useIndexedDB: true,
        clearOnInit: true
      });

      // Wait for initialization
      await hnsw1.ready();

      // Insert some test vectors
      const vectors = [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
        [0.7, 0.8, 0.9],
        [0.2, 0.3, 0.4]
      ];

      for (let i = 0; i < vectors.length; i++) {
        await hnsw1.insert(`node-${i}`, vectors[i]);
      }

      // Save the index
      await hnsw1.saveIndex();

      // Query original index to get baseline results
      const originalResults = await hnsw1.query([0.15, 0.25, 0.35], 2);
      expect(originalResults.keys).toHaveLength(2);

      // Create new instance (simulating app reload)
      const hnsw2 = new HNSW({
        distanceFunction: 'cosine-normalized',
        m: 4,
        efConstruction: 10,
        useIndexedDB: true,
        clearOnInit: false // Load persisted data
      });

      // Wait for initialization (should load persisted index)
      await hnsw2.ready();

      // Verify graphLayers are properly loaded and structured
      expect(hnsw2.graphLayers).toHaveLength(hnsw1.graphLayers.length);
      expect(hnsw2.entryPointKey).toBe(hnsw1.entryPointKey);

      // Verify each layer is a proper GraphLayer with Map structure
      for (let level = 0; level < hnsw2.graphLayers.length; level++) {
        const layer = hnsw2.graphLayers[level];
        expect(layer).toBeDefined();
        expect(layer.graph).toBeInstanceOf(Map);

        // Verify some nodes exist in the layer
        const nodeKeys = Array.from(layer.graph.keys());
        expect(nodeKeys.length).toBeGreaterThan(0);

        // Verify neighbors are Maps with number values
        for (const nodeKey of nodeKeys) {
          const neighbors = layer.graph.get(nodeKey);
          expect(neighbors).toBeInstanceOf(Map);
          expect(neighbors).toBeDefined();

          for (const [neighborKey, distance] of (neighbors as Map<string, number>).entries()) {
            expect(typeof neighborKey).toBe('string');
            expect(typeof distance).toBe('number');
            // Distance can be negative for some metrics, just check it's finite
            expect(isFinite(distance)).toBe(true);
          }
        }
      }

      // Test that query works after reload (this was failing before)
      const reloadedResults = await hnsw2.query([0.15, 0.25, 0.35], 2);
      expect(reloadedResults.keys).toHaveLength(2);

      // Results should be similar (same keys, possibly different order due to HNSW approximation)
      const originalKeySet = new Set(originalResults.keys);
      const reloadedKeySet = new Set(reloadedResults.keys);
      expect(originalKeySet).toEqual(reloadedKeySet);
    });

    test('should handle empty index serialization', async () => {
      // Create empty index
      const hnsw1 = new HNSW({
        distanceFunction: 'cosine-normalized',
        m: 4,
        efConstruction: 10,
        useIndexedDB: true,
        clearOnInit: true
      });

      await hnsw1.ready();

      // Save empty index
      await hnsw1.saveIndex();

      // Reload
      const hnsw2 = new HNSW({
        distanceFunction: 'cosine-normalized',
        m: 4,
        efConstruction: 10,
        useIndexedDB: true,
        clearOnInit: false
      });

      await hnsw2.ready();

      // Should have no layers initially
      expect(hnsw2.graphLayers).toHaveLength(0);
      expect(hnsw2.entryPointKey).toBeNull();
    });

    test('should maintain graph connectivity after reload', async () => {
      const hnsw1 = new HNSW({
        distanceFunction: 'cosine-normalized',
        m: 4,
        efConstruction: 10,
        useIndexedDB: true,
        clearOnInit: true
      });

      await hnsw1.ready();

      // Insert nodes that will create connections
      await hnsw1.insert('a', [0.0, 0.0, 1.0]);
      await hnsw1.insert('b', [0.0, 1.0, 0.0]);
      await hnsw1.insert('c', [1.0, 0.0, 0.0]);

      await hnsw1.saveIndex();

      const hnsw2 = new HNSW({
        distanceFunction: 'cosine-normalized',
        m: 4,
        efConstruction: 10,
        useIndexedDB: true,
        clearOnInit: false
      });

      await hnsw2.ready();

      // Verify connectivity by checking that nodes have neighbors
      let totalConnections = 0;
      for (const layer of hnsw2.graphLayers) {
        for (const neighbors of layer.graph.values()) {
          totalConnections += neighbors.size;
        }
      }
      expect(totalConnections).toBeGreaterThan(0);

      // Query should work
      const results = await hnsw2.query([0.1, 0.1, 0.8], 3);
      expect(results.keys).toContain('a'); // Should find the closest node
    });

    test('should correctly rehydrate GraphLayer instances', async () => {
      const hnsw1 = new HNSW({
        distanceFunction: 'cosine-normalized',
        m: 4,
        efConstruction: 10,
        useIndexedDB: true,
        clearOnInit: true
      });

      await hnsw1.ready();

      await hnsw1.insert('test-node', [0.5, 0.5, 0.5]);
      await hnsw1.saveIndex();

      const hnsw2 = new HNSW({
        distanceFunction: 'cosine-normalized',
        m: 4,
        efConstruction: 10,
        useIndexedDB: true,
        clearOnInit: false
      });

      await hnsw2.ready();

      // Verify that graphLayers contains GraphLayer instances, not plain objects
      for (const layer of hnsw2.graphLayers) {
        expect(layer.constructor.name).toBe('GraphLayer');
        expect(typeof layer.toJSON).toBe('function');
        expect(typeof layer.loadJSON).toBe('function');
      }
    });
  });
});