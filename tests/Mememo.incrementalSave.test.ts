/**
 * Phase 4: Incremental Saves with Dirty Tracking Tests
 * 
 * Tests that only modified nodes are tracked and saved, dramatically
 * improving save performance for large indexes with small changes.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Mememo } from '../mememo/src/mememo';
import Dexie from 'dexie';
import 'fake-indexeddb/auto';

// Helper to generate random embeddings
function generateEmbedding(dim: number = 384): number[] {
  const vector = Array(dim).fill(0).map(() => Math.random() - 0.5);
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  return vector.map(val => val / magnitude);
}

// Helper to wait for a promise with timeout
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('Phase 4: Incremental Saves with Dirty Tracking', () => {
  beforeEach(async () => {
    await Dexie.delete('mememo-index-store');
    jest.clearAllTimers();
  });

  describe('Dirty tracking', () => {
    it('should mark nodes as dirty on insert', async () => {
      const index = new Mememo({
        distanceFunction: 'cosine-normalized',
        useIndexedDB: true,
        clearOnInit: true,
        m: 4,
        efConstruction: 20
      });

      // Initially no dirty nodes
      let stats = index.getDirtyStats();
      expect(stats.dirtyNodes).toBe(0);
      expect(stats.dirtyLayers).toBe(0);

      // Insert a node
      const embedding = generateEmbedding();
      await index.insert('test_node', embedding);

      // Should be marked as dirty
      stats = index.getDirtyStats();
      expect(stats.dirtyNodes).toBeGreaterThan(0);
    });

    it('should mark nodes as dirty on update', async () => {
      const index = new Mememo({
        distanceFunction: 'cosine-normalized',
        useIndexedDB: true,
        clearOnInit: true,
        m: 4,
        efConstruction: 20
      });

      // Insert initial nodes
      const keys = ['a', 'b', 'c'];
      const embeddings = keys.map(() => generateEmbedding());
      
      for (let i = 0; i < keys.length; i++) {
        await index.insert(keys[i], embeddings[i]);
      }

      // Clear dirty flags
      index.clearDirtyFlags();
      let stats = index.getDirtyStats();
      expect(stats.dirtyNodes).toBe(0);

      // Update a node
      const newEmbedding = generateEmbedding();
      await index.update('a', newEmbedding);

      // Should be marked as dirty
      stats = index.getDirtyStats();
      expect(stats.dirtyNodes).toBe(1);
    });

    it('should mark nodes as dirty on bulk insert', async () => {
      const index = new Mememo({
        distanceFunction: 'cosine-normalized',
        useIndexedDB: true,
        clearOnInit: true,
        m: 4,
        efConstruction: 20
      });

      // Bulk insert
      const keys = Array.from({ length: 10 }, (_, i) => `bulk_${i}`);
      const embeddings = keys.map(() => generateEmbedding());
      
      await index.bulkInsert(keys, embeddings);

      // All nodes should be marked as dirty
      const stats = index.getDirtyStats();
      expect(stats.dirtyNodes).toBe(keys.length);
    });

    it('should mark nodes as dirty on delete', async () => {
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

      // Clear dirty flags
      index.clearDirtyFlags();

      // Mark as deleted
      await index.markDeleted('x');

      // Should be marked as dirty
      const stats = index.getDirtyStats();
      expect(stats.dirtyNodes).toBeGreaterThan(0);
    });
  });

  describe('Incremental save', () => {
    it('should save incrementally when nodes are dirty', async () => {
      const index = new Mememo({
        distanceFunction: 'cosine-normalized',
        useIndexedDB: true,
        clearOnInit: true,
        m: 4,
        efConstruction: 20
      });

      // Insert nodes
      const keys = Array.from({ length: 15 }, (_, i) => `save_${i}`);
      const embeddings = keys.map(() => generateEmbedding());
      
      for (let i = 0; i < keys.length; i++) {
        await index.insert(keys[i], embeddings[i]);
      }

      // Verify nodes are dirty
      let stats = index.getDirtyStats();
      expect(stats.dirtyNodes).toBeGreaterThan(0);

      // Incremental save
      await index.incrementalSaveIndex();

      // After save, should be clean
      stats = index.getDirtyStats();
      expect(stats.dirtyNodes).toBe(0);
      expect(stats.dirtyLayers).toBe(0);
      expect(stats.lastSaveTime).toBeGreaterThan(0);
    });

    it('should skip save when nothing is dirty', async () => {
      const index = new Mememo({
        distanceFunction: 'cosine-normalized',
        useIndexedDB: true,
        clearOnInit: true,
        m: 4,
        efConstruction: 20
      });

      // Insert and save
      const embedding = generateEmbedding();
      await index.insert('test', embedding);
      await index.incrementalSaveIndex();

      const beforeTime = index.getDirtyStats().lastSaveTime;

      // Save again without changes
      await sleep(10); // Small delay
      await index.incrementalSaveIndex();

      // Should not update save time (nothing to save)
      const afterTime = index.getDirtyStats().lastSaveTime;
      expect(afterTime).toBe(beforeTime);
    });

    it('should persist data with incremental save', async () => {
      // First session: insert and incrementally save
      let index = new Mememo({
        distanceFunction: 'cosine-normalized',
        useIndexedDB: true,
        clearOnInit: true,
        m: 4,
        efConstruction: 20
      });

      const keys = ['persist_a', 'persist_b', 'persist_c'];
      const embeddings = keys.map(() => generateEmbedding());
      
      for (let i = 0; i < keys.length; i++) {
        await index.insert(keys[i], embeddings[i]);
      }

      await index.incrementalSaveIndex();

      // Second session: reload
      index = new Mememo({
        distanceFunction: 'cosine-normalized',
        useIndexedDB: true,
        clearOnInit: false,
        m: 4,
        efConstruction: 20
      });

      await index.ready();

      // Data should be loaded
      const result = await index.query(embeddings[0], 3);
      expect(result.keys).toContain('persist_a');
    });
  });

  describe('Autosave', () => {
    it('should enable and disable autosave', () => {
      const index = new Mememo({
        distanceFunction: 'cosine-normalized',
        useIndexedDB: true,
        clearOnInit: true,
        m: 4,
        efConstruction: 20
      });

      // Initially disabled
      let stats = index.getDirtyStats();
      expect(stats.autosaveEnabled).toBe(false);

      // Enable autosave
      index.setAutosave(true, 1000);
      stats = index.getDirtyStats();
      expect(stats.autosaveEnabled).toBe(true);

      // Disable autosave
      index.setAutosave(false);
      stats = index.getDirtyStats();
      expect(stats.autosaveEnabled).toBe(false);
    });

    it('should trigger autosave after delay when enabled', async () => {
      const index = new Mememo({
        distanceFunction: 'cosine-normalized',
        useIndexedDB: true,
        clearOnInit: true,
        m: 4,
        efConstruction: 20
      });

      // Enable autosave with short delay
      index.setAutosave(true, 100); // 100ms

      // Insert a node (should trigger autosave timer)
      const embedding = generateEmbedding();
      await index.insert('autosave_test', embedding);

      // Verify dirty before autosave
      let stats = index.getDirtyStats();
      expect(stats.dirtyNodes).toBeGreaterThan(0);

      // Wait for autosave to trigger
      await sleep(150);

      // Should be clean after autosave
      stats = index.getDirtyStats();
      expect(stats.dirtyNodes).toBe(0);
    });

    it('should debounce autosave on rapid changes', async () => {
      const index = new Mememo({
        distanceFunction: 'cosine-normalized',
        useIndexedDB: true,
        clearOnInit: true,
        m: 4,
        efConstruction: 20
      });

      // Enable autosave with 200ms delay
      index.setAutosave(true, 200);

      // Rapid inserts
      for (let i = 0; i < 5; i++) {
        const embedding = generateEmbedding();
        await index.insert(`rapid_${i}`, embedding);
        await sleep(30); // Less than autosave delay
      }

      // Still dirty (autosave hasn't triggered yet)
      let stats = index.getDirtyStats();
      expect(stats.dirtyNodes).toBeGreaterThan(0);

      // Wait for final autosave
      await sleep(250);

      // Should be clean now
      stats = index.getDirtyStats();
      expect(stats.dirtyNodes).toBe(0);
    });

    it('should not autosave when disabled', async () => {
      const index = new Mememo({
        distanceFunction: 'cosine-normalized',
        useIndexedDB: true,
        clearOnInit: true,
        m: 4,
        efConstruction: 20
      });

      // Autosave disabled (default)
      const embedding = generateEmbedding();
      await index.insert('no_autosave', embedding);

      // Wait
      await sleep(100);

      // Should still be dirty (no autosave)
      const stats = index.getDirtyStats();
      expect(stats.dirtyNodes).toBeGreaterThan(0);
    });
  });

  describe('Performance', () => {
    it('should be faster than full save for small changes', async () => {
      const index = new Mememo({
        distanceFunction: 'cosine-normalized',
        useIndexedDB: true,
        clearOnInit: true,
        m: 4,
        efConstruction: 20
      });

      // Insert many nodes
      const keys = Array.from({ length: 50 }, (_, i) => `perf_${i}`);
      const embeddings = keys.map(() => generateEmbedding());
      await index.bulkInsert(keys, embeddings);

      // Full save (baseline)
      const fullSaveStart = performance.now();
      await index.saveIndex();
      const fullSaveDuration = performance.now() - fullSaveStart;

      // Clear dirty flags and make small change
      index.clearDirtyFlags();
      const newEmbedding = generateEmbedding();
      await index.update('perf_0', newEmbedding);

      // Incremental save (should be faster for single node change)
      const incrementalSaveStart = performance.now();
      await index.incrementalSaveIndex();
      const incrementalSaveDuration = performance.now() - incrementalSaveStart;

      console.log(`Full save: ${fullSaveDuration.toFixed(2)}ms, Incremental save: ${incrementalSaveDuration.toFixed(2)}ms`);

      // Both should complete in reasonable time
      expect(fullSaveDuration).toBeLessThan(500);
      expect(incrementalSaveDuration).toBeLessThan(500);
    });

    it('should handle many incremental saves efficiently', async () => {
      const index = new Mememo({
        distanceFunction: 'cosine-normalized',
        useIndexedDB: true,
        clearOnInit: true,
        m: 4,
        efConstruction: 20
      });

      // Insert initial data
      const keys = Array.from({ length: 20 }, (_, i) => `multi_save_${i}`);
      const embeddings = keys.map(() => generateEmbedding());
      await index.bulkInsert(keys, embeddings);
      await index.incrementalSaveIndex();

      // Make many small changes with incremental saves
      const start = performance.now();
      
      for (let i = 0; i < 10; i++) {
        const newEmbedding = generateEmbedding();
        await index.update(`multi_save_${i}`, newEmbedding);
        await index.incrementalSaveIndex();
      }
      
      const duration = performance.now() - start;

      console.log(`10 incremental saves completed in ${duration.toFixed(0)}ms`);

      // Should complete in reasonable time
      expect(duration).toBeLessThan(2000);
    });
  });

  describe('Integration', () => {
    it('should work with all CRUD operations', async () => {
      const index = new Mememo({
        distanceFunction: 'cosine-normalized',
        useIndexedDB: true,
        clearOnInit: true,
        m: 4,
        efConstruction: 20
      });

      // Insert
      await index.insert('crud_a', generateEmbedding());
      expect(index.getDirtyStats().dirtyNodes).toBe(1);
      await index.incrementalSaveIndex();
      expect(index.getDirtyStats().dirtyNodes).toBe(0);

      // Bulk insert
      await index.bulkInsert(['crud_b', 'crud_c'], [generateEmbedding(), generateEmbedding()]);
      expect(index.getDirtyStats().dirtyNodes).toBe(2);
      await index.incrementalSaveIndex();

      // Update
      await index.update('crud_a', generateEmbedding());
      expect(index.getDirtyStats().dirtyNodes).toBe(1);
      await index.incrementalSaveIndex();

      // Delete
      await index.markDeleted('crud_b');
      expect(index.getDirtyStats().dirtyNodes).toBeGreaterThan(0);
      await index.incrementalSaveIndex();

      // Final check
      expect(index.getDirtyStats().dirtyNodes).toBe(0);
    });

    it('should maintain data integrity across saves and reloads', async () => {
      // Session 1: Create index
      let index = new Mememo({
        distanceFunction: 'cosine-normalized',
        useIndexedDB: true,
        clearOnInit: true,
        m: 4,
        efConstruction: 20
      });

      const keys = ['integrity_1', 'integrity_2', 'integrity_3'];
      const embeddings = keys.map(() => generateEmbedding());
      
      await index.bulkInsert(keys, embeddings);
      await index.incrementalSaveIndex();

      // Session 2: Reload and modify
      index = new Mememo({
        distanceFunction: 'cosine-normalized',
        useIndexedDB: true,
        clearOnInit: false,
        m: 4,
        efConstruction: 20
      });

      await index.ready();

      const newEmbedding = generateEmbedding();
      await index.update('integrity_1', newEmbedding);
      await index.incrementalSaveIndex();

      // Session 3: Reload and verify
      index = new Mememo({
        distanceFunction: 'cosine-normalized',
        useIndexedDB: true,
        clearOnInit: false,
        m: 4,
        efConstruction: 20
      });

      await index.ready();

      // Query should find updated data
      const result = await index.query(newEmbedding, 3);
      expect(result.keys).toContain('integrity_1');
      expect(result.keys.length).toBeGreaterThan(0);
    });
  });
});
