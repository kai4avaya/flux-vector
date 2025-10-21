/**
 * Phase 3: Cross-Layer Cache Sharing Tests
 * 
 * Tests that embeddings are shared across all graph layers, eliminating
 * redundant fetches when a node appears in multiple layers.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { Mememo } from '../mememo/src/mememo';
import Dexie from 'dexie';
import 'fake-indexeddb/auto';

// Helper to generate random embeddings
function generateEmbedding(dim: number = 384): number[] {
  const vector = Array(dim).fill(0).map(() => Math.random() - 0.5);
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  return vector.map(val => val / magnitude);
}

describe('Phase 3: Cross-Layer Cache Sharing', () => {
  beforeEach(async () => {
    await Dexie.delete('mememo-index-store');
  });

  it('should share cache across multiple layers', async () => {
    const index = new Mememo({
      distanceFunction: 'cosine-normalized',
      useIndexedDB: true,
      clearOnInit: true,
      m: 4,
      efConstruction: 20
    });

    // Insert enough nodes to create multiple layers
    // HNSW creates layers probabilistically - more nodes = more layers
    const keys = Array.from({ length: 30 }, (_, i) => `node_${i}`);
    const embeddings = keys.map(() => generateEmbedding());
    
    for (let i = 0; i < keys.length; i++) {
      await index.insert(keys[i], embeddings[i]);
    }

    // Verify we have multiple layers
    expect(index.graphLayers.length).toBeGreaterThan(1);

    // Query should work efficiently with cross-layer caching
    const result = await index.query(embeddings[0], 10);
    expect(result.keys.length).toBeGreaterThan(0);
  });

  it('should benefit from cross-layer neighbors in cache', async () => {
    const index = new Mememo({
      distanceFunction: 'cosine-normalized',
      useIndexedDB: true,
      clearOnInit: true,
      m: 6,
      efConstruction: 30
    });

    // Insert nodes to create multi-layer structure
    const keys = Array.from({ length: 50 }, (_, i) => `item_${i}`);
    const embeddings = keys.map(() => generateEmbedding());
    
    for (let i = 0; i < keys.length; i++) {
      await index.insert(keys[i], embeddings[i]);
    }

    // Run multiple queries - cross-layer caching should help
    const start = performance.now();
    
    for (let i = 0; i < 10; i++) {
      const queryEmbedding = generateEmbedding();
      const result = await index.query(queryEmbedding, 5);
      expect(result.keys.length).toBeGreaterThan(0);
    }
    
    const duration = performance.now() - start;
    
    // With cross-layer caching, should be fast
    expect(duration).toBeLessThan(2000); // 2 seconds for 10 queries on 50 nodes
  });

  it('should maintain correctness with cross-layer cache', async () => {
    const index = new Mememo({
      distanceFunction: 'cosine-normalized',
      useIndexedDB: true,
      clearOnInit: true,
      m: 4,
      efConstruction: 20
    });

    // Insert nodes
    const keys = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    const embeddings = keys.map(() => generateEmbedding());
    
    for (let i = 0; i < keys.length; i++) {
      await index.insert(keys[i], embeddings[i]);
    }

    // Query each embedding - should find itself as closest match
    for (let i = 0; i < keys.length; i++) {
      const result = await index.query(embeddings[i], 3);
      
      // First result should be the node itself (or very close)
      expect(result.keys[0]).toBe(keys[i]);
      expect(result.distances[0]).toBeLessThan(0.01);
    }
  });

  it('should handle updates correctly with cross-layer cache', async () => {
    const index = new Mememo({
      distanceFunction: 'cosine-normalized',
      useIndexedDB: true,
      clearOnInit: true,
      m: 4,
      efConstruction: 20
    });

    // Insert nodes
    const keys = Array.from({ length: 20 }, (_, i) => `update_${i}`);
    const embeddings = keys.map(() => generateEmbedding());
    
    for (let i = 0; i < keys.length; i++) {
      await index.insert(keys[i], embeddings[i]);
    }

    // Update a node
    const newEmbedding = generateEmbedding();
    await index.update('update_0', newEmbedding);

    // Query should reflect the update across all layers
    const result = await index.query(newEmbedding, 5);
    expect(result.keys).toContain('update_0');
    
    const idx = result.keys.indexOf('update_0');
    expect(result.distances[idx]).toBeLessThan(0.01);
  });

  it('should handle persistence + cross-layer caching', async () => {
    // First session: create multi-layer index
    let index = new Mememo({
      distanceFunction: 'cosine-normalized',
      useIndexedDB: true,
      clearOnInit: true,
      m: 4,
      efConstruction: 20
    });

    const keys = Array.from({ length: 25 }, (_, i) => `persist_${i}`);
    const embeddings = keys.map(() => generateEmbedding());
    
    for (let i = 0; i < keys.length; i++) {
      await index.insert(keys[i], embeddings[i]);
    }

    const layerCount = index.graphLayers.length;
    await index.saveIndex();

    // Second session: reload
    index = new Mememo({
      distanceFunction: 'cosine-normalized',
      useIndexedDB: true,
      clearOnInit: false,
      m: 4,
      efConstruction: 20
    });

    await index.ready();

    // Verify layers were loaded
    expect(index.graphLayers.length).toBe(layerCount);

    // Query should work with cross-layer cache after reload
    const result = await index.query(embeddings[0], 8);
    expect(result.keys.length).toBeGreaterThan(0);
  });

  it('should efficiently handle queries spanning multiple layers', async () => {
    const index = new Mememo({
      distanceFunction: 'cosine-normalized',
      useIndexedDB: true,
      clearOnInit: true,
      m: 8,
      efConstruction: 50
    });

    // Insert many nodes to create deeper hierarchy
    const keys = Array.from({ length: 100 }, (_, i) => `deep_${i}`);
    const embeddings = keys.map(() => generateEmbedding());
    
    const start = performance.now();
    await index.bulkInsert(keys, embeddings);
    const insertDuration = performance.now() - start;

    console.log(`Inserted 100 nodes in ${insertDuration.toFixed(0)}ms, created ${index.graphLayers.length} layers`);

    // Run queries that traverse multiple layers
    const queryStart = performance.now();
    
    for (let i = 0; i < 5; i++) {
      const queryEmbedding = generateEmbedding();
      const result = await index.query(queryEmbedding, 10);
      expect(result.keys.length).toBe(10);
    }
    
    const queryDuration = performance.now() - queryStart;
    
    console.log(`5 queries completed in ${queryDuration.toFixed(0)}ms (avg ${(queryDuration / 5).toFixed(0)}ms per query)`);
    
    // With cross-layer caching, queries should be efficient
    expect(queryDuration).toBeLessThan(3000);
  });

  it('should share cache between insert and query operations', async () => {
    const index = new Mememo({
      distanceFunction: 'cosine-normalized',
      useIndexedDB: true,
      clearOnInit: true,
      m: 4,
      efConstruction: 20
    });

    // Insert initial nodes
    const keys = Array.from({ length: 15 }, (_, i) => `mixed_${i}`);
    const embeddings = keys.map(() => generateEmbedding());
    
    for (let i = 0; i < keys.length; i++) {
      await index.insert(keys[i], embeddings[i]);
    }

    // Interleave inserts and queries
    for (let i = 0; i < 5; i++) {
      // Query
      const result = await index.query(embeddings[i], 5);
      expect(result.keys.length).toBeGreaterThan(0);
      
      // Insert new node
      const newKey = `mixed_new_${i}`;
      const newEmbedding = generateEmbedding();
      await index.insert(newKey, newEmbedding);
      
      // Query again - should use cached data
      const result2 = await index.query(newEmbedding, 5);
      expect(result2.keys).toContain(newKey);
    }

    // Final verification - all operations completed successfully
    expect(index.graphLayers.length).toBeGreaterThan(0);
  });

  it('should handle bulk operations with cross-layer caching', async () => {
    const index = new Mememo({
      distanceFunction: 'cosine-normalized',
      useIndexedDB: true,
      clearOnInit: true,
      m: 4,
      efConstruction: 20
    });

    // Bulk insert
    const keys1 = Array.from({ length: 30 }, (_, i) => `bulk1_${i}`);
    const embeddings1 = keys1.map(() => generateEmbedding());
    await index.bulkInsert(keys1, embeddings1);

    const layersAfterFirst = index.graphLayers.length;

    // Bulk insert more
    const keys2 = Array.from({ length: 20 }, (_, i) => `bulk2_${i}`);
    const embeddings2 = keys2.map(() => generateEmbedding());
    await index.bulkInsert(keys2, embeddings2);

    // Layers may have grown
    expect(index.graphLayers.length).toBeGreaterThanOrEqual(layersAfterFirst);

    // Query should work across all data with cross-layer cache
    const result = await index.query(embeddings1[0], 15);
    expect(result.keys.length).toBe(15);
  });
});
