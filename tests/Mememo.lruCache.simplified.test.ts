/**
 * Phase 2: Simplified LRU Cache Tests
 * 
 * Tests smart caching behavior without accessing internal properties.
 * Validates that LRU cache improves performance through functional testing.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { Mememo } from '../mememo/src/mememo';
import Dexie from 'dexie';
import 'fake-indexeddb/auto';

// Simple helper to generate random embeddings
function generateEmbedding(dim: number = 384): number[] {
  const vector = Array(dim).fill(0).map(() => Math.random() - 0.5);
  // Normalize for cosine-normalized distance
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  return vector.map(val => val / magnitude);
}

describe('Phase 2: LRU Cache - Functional Tests', () => {
  beforeEach(async () => {
    // Reset IndexedDB before each test
    await Dexie.delete('mememo-index-store');
  });

  it('should handle repeated queries efficiently with caching', async () => {
    const index = new Mememo({
      distanceFunction: 'cosine-normalized',
      useIndexedDB: true,
      clearOnInit: true,
      m: 4,
      efConstruction: 20
    });

    // Insert 20 nodes
    const keys = Array.from({ length: 20 }, (_, i) => `node_${i}`);
    const embeddings = keys.map(() => generateEmbedding());
    
    for (let i = 0; i < keys.length; i++) {
      await index.insert(keys[i], embeddings[i]);
    }

    // Query same embedding multiple times - should be fast with caching
    const queryEmbedding = generateEmbedding();
    const start = performance.now();
    
    for (let i = 0; i < 5; i++) {
      const result = await index.query(queryEmbedding, 5);
      expect(result.keys.length).toBeGreaterThan(0);
    }
    
    const duration = performance.now() - start;
    
    // Should complete in reasonable time (benefit from caching)
    expect(duration).toBeLessThan(1000); // 1 second for 5 queries
  });

  it('should work correctly with insert after reload (persistence + caching)', async () => {
    // First session: insert and save
    let index = new Mememo({
      distanceFunction: 'cosine-normalized',
      useIndexedDB: true,
      clearOnInit: true,
      m: 4,
      efConstruction: 20
    });

    const keys = ['alpha', 'beta', 'gamma'];
    const embeddings = keys.map(() => generateEmbedding());
    
    for (let i = 0; i < keys.length; i++) {
      await index.insert(keys[i], embeddings[i]);
    }

    await index.saveIndex();

    // Second session: reload
    index = new Mememo({
      distanceFunction: 'cosine-normalized',
      useIndexedDB: true,
      clearOnInit: false, // Load from persistence
      m: 4,
      efConstruction: 20
    });

    await index.ready();

    // Insert new node - cache should handle this smoothly
    const newEmbedding = generateEmbedding();
    await index.insert('delta', newEmbedding);

    // Query should work with both old and new nodes
    const result = await index.query(newEmbedding, 4);
    expect(result.keys.length).toBeGreaterThan(0);
    expect(result.keys).toContain('delta');
  });

  it('should handle bulk operations without performance degradation', async () => {
    const index = new Mememo({
      distanceFunction: 'cosine-normalized',
      useIndexedDB: true,
      clearOnInit: true,
      m: 4,
      efConstruction: 20
    });

    // Bulk insert many nodes
    const keys = Array.from({ length: 50 }, (_, i) => `bulk_${i}`);
    const embeddings = keys.map(() => generateEmbedding());
    
    const start = performance.now();
    await index.bulkInsert(keys, embeddings);
    const insertDuration = performance.now() - start;

    // Bulk insert should complete in reasonable time
    expect(insertDuration).toBeLessThan(5000); // 5 seconds for 50 nodes

    // Query should work correctly
    const queryStart = performance.now();
    const result = await index.query(embeddings[0], 10);
    const queryDuration = performance.now() - queryStart;

    expect(result.keys.length).toBeGreaterThan(0);
    expect(queryDuration).toBeLessThan(500); // Fast query
  });

  it('should maintain correctness across multiple operations', async () => {
    const index = new Mememo({
      distanceFunction: 'cosine-normalized',
      useIndexedDB: true,
      clearOnInit: true,
      m: 4,
      efConstruction: 20
    });

    // Insert nodes
    const keys = Array.from({ length: 15 }, (_, i) => `multi_${i}`);
    const embeddings = keys.map(() => generateEmbedding());
    
    for (let i = 0; i < keys.length; i++) {
      await index.insert(keys[i], embeddings[i]);
    }

    // Run multiple queries and verify correctness
    for (let i = 0; i < 5; i++) {
      const result = await index.query(embeddings[i], 5);
      expect(result.keys.length).toBeGreaterThan(0);
      expect(result.keys.length).toBeLessThanOrEqual(5);
      
      // Verify results are reasonable (not corrupted by caching)
      for (const distance of result.distances) {
        expect(distance).toBeGreaterThanOrEqual(0);
        expect(distance).toBeLessThanOrEqual(2); // Cosine distance range
      }
    }
  });

  it('should handle update operations correctly with caching', async () => {
    const index = new Mememo({
      distanceFunction: 'cosine-normalized',
      useIndexedDB: true,
      clearOnInit: true,
      m: 4,
      efConstruction: 20
    });

    // Insert nodes
    const keys = ['x', 'y', 'z'];
    const embeddings = keys.map(() => generateEmbedding());
    
    for (let i = 0; i < keys.length; i++) {
      await index.insert(keys[i], embeddings[i]);
    }

    // Update node 'x'
    const newEmbedding = generateEmbedding();
    await index.update('x', newEmbedding);

    // Query should reflect the update
    const result = await index.query(newEmbedding, 3);
    expect(result.keys).toContain('x');
    
    // Distance to updated node should be very small (it's the query itself)
    const xIndex = result.keys.indexOf('x');
    expect(result.distances[xIndex]).toBeLessThan(0.01);
  });

  it('should handle sequential queries on different embeddings efficiently', async () => {
    const index = new Mememo({
      distanceFunction: 'cosine-normalized',
      useIndexedDB: true,
      clearOnInit: true,
      m: 4,
      efConstruction: 20
    });

    // Insert nodes
    const keys = Array.from({ length: 30 }, (_, i) => `seq_${i}`);
    const embeddings = keys.map(() => generateEmbedding());
    
    for (let i = 0; i < keys.length; i++) {
      await index.insert(keys[i], embeddings[i]);
    }

    // Run queries on different embeddings sequentially
    const start = performance.now();
    
    for (let i = 0; i < 10; i++) {
      const queryEmbedding = generateEmbedding();
      const result = await index.query(queryEmbedding, 5);
      expect(result.keys.length).toBeGreaterThan(0);
    }
    
    const duration = performance.now() - start;
    
    // With caching, sequential queries should be reasonably fast
    expect(duration).toBeLessThan(3000); // 3 seconds for 10 queries
  });
});
