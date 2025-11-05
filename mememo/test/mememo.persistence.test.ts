/**
 * Test suite for HNSW index persistence functionality
 * Tests the ability to save and load indexes across sessions
 */

// Polyfill IndexedDB for Node.js testing
import 'fake-indexeddb/auto';

import { describe, it, expect, beforeEach } from 'vitest';
import { HNSW as Mememo } from '../src/mememo';
import Dexie from 'dexie';

// Helper function to generate random embeddings
function generateEmbedding(dim: number): number[] {
  return Array.from({ length: dim }, () => Math.random());
}

// Helper function to clear IndexedDB between tests
async function clearIndexedDB() {
  const dexie = new Dexie('mememo-index-store');
  await dexie.delete();
}

describe('HNSW Persistence', () => {
  const dimension = 128;
  const numDocuments = 50;

  beforeEach(async () => {
    // Clear IndexedDB before each test to ensure clean state
    await clearIndexedDB();
  });

  it('should save and load index with clearOnInit=false', async () => {
    // Step 1: Create an index with clearOnInit=false and insert data
    const index1 = new Mememo({
      distanceFunction: 'cosine-normalized',
      m: 16,
      efConstruction: 100,
      useIndexedDB: true,
      clearOnInit: false
    });

    // Insert documents
    const keys: string[] = [];
    const embeddings: number[][] = [];
    for (let i = 0; i < numDocuments; i++) {
      const key = `doc-${i}`;
      const embedding = generateEmbedding(dimension);
      keys.push(key);
      embeddings.push(embedding);
      await index1.insert(key, embedding);
    }

    // Verify the index has the correct size
    const size1 = await index1.nodes.size();
    expect(size1).toBe(numDocuments);

    // Save the index
    await index1.saveIndex();

    // Step 2: Create a new instance (simulating app restart)
    const index2 = new Mememo({
      distanceFunction: 'cosine-normalized',
      m: 16,
      efConstruction: 100,
      useIndexedDB: true,
      clearOnInit: false
    });

    // Wait for async initialization to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    // The index should have loaded the persisted data
    const size2 = await index2.nodes.size();
    expect(size2).toBe(numDocuments);

    // Verify we can query the loaded index
    const queryEmbedding = embeddings[0];
    const results = await index2.query(queryEmbedding, 5);
    expect(results.keys.length).toBeGreaterThan(0);
    expect(results.keys[0]).toBe(keys[0]);
  });

  it('should clear data when clearOnInit=true (default behavior)', async () => {
    // Step 1: Create an index and insert data
    const index1 = new Mememo({
      distanceFunction: 'cosine-normalized',
      m: 16,
      efConstruction: 100,
      useIndexedDB: true,
      clearOnInit: false
    });

    for (let i = 0; i < 10; i++) {
      await index1.insert(`doc-${i}`, generateEmbedding(dimension));
    }

    await index1.saveIndex();
    const size1 = await index1.nodes.size();
    expect(size1).toBe(10);

    // Step 2: Create a new instance with clearOnInit=true
    const index2 = new Mememo({
      distanceFunction: 'cosine-normalized',
      m: 16,
      efConstruction: 100,
      useIndexedDB: true,
      clearOnInit: true // Explicitly set to true (default)
    });

    // Wait a bit for clearing to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    // The index should be empty
    const size2 = await index2.nodes.size();
    expect(size2).toBe(0);
  });

  it('should persist graph structure and metadata correctly', async () => {
    // Create an index with specific configuration
    const config = {
      distanceFunction: 'cosine' as const,
      m: 24,
      efConstruction: 200,
      useIndexedDB: true,
      clearOnInit: false
    };

    const index1 = new Mememo(config);

    // Insert some documents
    for (let i = 0; i < 20; i++) {
      await index1.insert(`doc-${i}`, generateEmbedding(dimension));
    }

    // Export and save
    const exportedData = index1.exportIndex();
    await index1.saveIndex();

    // Verify exported data has correct metadata
    expect(exportedData.m).toBe(24);
    expect(exportedData.efConstruction).toBe(200);
    expect(exportedData.distanceFunctionType).toBe('cosine');

    // Create new instance and load
    const index2 = new Mememo({
      ...config,
      clearOnInit: false
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify loaded data matches
    const loadedData = index2.exportIndex();
    expect(loadedData.m).toBe(exportedData.m);
    expect(loadedData.efConstruction).toBe(exportedData.efConstruction);
    expect(loadedData.distanceFunctionType).toBe(exportedData.distanceFunctionType);
    expect(loadedData.graphLayers.length).toBe(exportedData.graphLayers.length);
  });

  it('should handle multiple save/load cycles', async () => {
    const config = {
      distanceFunction: 'cosine-normalized' as const,
      m: 16,
      efConstruction: 100,
      useIndexedDB: true,
      clearOnInit: false
    };

    // Cycle 1: Create and save
    const index1 = new Mememo(config);
    for (let i = 0; i < 10; i++) {
      await index1.insert(`doc-${i}`, generateEmbedding(dimension));
    }
    await index1.saveIndex();
    let size = await index1.nodes.size();
    expect(size).toBe(10);

    // Cycle 2: Load, add more, save
    const index2 = new Mememo(config);
    await new Promise(resolve => setTimeout(resolve, 100));
    for (let i = 10; i < 20; i++) {
      await index2.insert(`doc-${i}`, generateEmbedding(dimension));
    }
    await index2.saveIndex();
    size = await index2.nodes.size();
    expect(size).toBe(20);

    // Cycle 3: Load and verify
    const index3 = new Mememo(config);
    await new Promise(resolve => setTimeout(resolve, 100));
    size = await index3.nodes.size();
    expect(size).toBe(20);
  });

  it('should handle empty index persistence', async () => {
    // Create empty index and save
    const index1 = new Mememo({
      distanceFunction: 'cosine-normalized',
      useIndexedDB: true,
      clearOnInit: false
    });

    await index1.saveIndex();
    const size1 = await index1.nodes.size();
    expect(size1).toBe(0);

    // Load and verify still empty
    const index2 = new Mememo({
      distanceFunction: 'cosine-normalized',
      useIndexedDB: true,
      clearOnInit: false
    });

    await new Promise(resolve => setTimeout(resolve, 100));
    const size2 = await index2.nodes.size();
    expect(size2).toBe(0);
  });

  it('should maintain search accuracy after persistence', async () => {
    const config = {
      distanceFunction: 'cosine-normalized' as const,
      m: 16,
      efConstruction: 100,
      useIndexedDB: true,
      clearOnInit: false
    };

    // Create index and insert documents
    const index1 = new Mememo(config);
    const testEmbeddings: { key: string; embedding: number[] }[] = [];
    
    for (let i = 0; i < 30; i++) {
      const key = `doc-${i}`;
      const embedding = generateEmbedding(dimension);
      testEmbeddings.push({ key, embedding });
      await index1.insert(key, embedding);
    }

    // Query before saving
    const queryEmbedding = testEmbeddings[0].embedding;
    const resultsBefore = await index1.query(queryEmbedding, 5);
    
    // Save
    await index1.saveIndex();

    // Load in new instance
    const index2 = new Mememo(config);
    await new Promise(resolve => setTimeout(resolve, 100));

    // Query after loading
    const resultsAfter = await index2.query(queryEmbedding, 5);

    // Results should be similar (same top result)
    expect(resultsAfter.keys.length).toBe(resultsBefore.keys.length);
    expect(resultsAfter.keys[0]).toBe(resultsBefore.keys[0]);
  });

  it('should throw error when saving with useIndexedDB=false', async () => {
    const index = new Mememo({
      distanceFunction: 'cosine-normalized',
      useIndexedDB: false // In-memory only
    });

    await expect(async () => {
      await index.saveIndex();
    }).rejects.toThrow('Cannot save index: IndexedDB is not enabled');
  });

  it('should return null when loading with no persisted data', async () => {
    const index = new Mememo({
      distanceFunction: 'cosine-normalized',
      useIndexedDB: true,
      clearOnInit: true // Clear on init
    });

    const loaded = await index.loadPersistedIndex();
    expect(loaded).toBeNull();
  });
});
