import { HNSW } from './dist/mememo.js';

// Test script to reproduce the reload failure
async function testReloadFailure() {
  console.log('=== Testing Reload Failure Scenario ===');

  try {
    // Step 1: Create and populate an index
    console.log('\n--- Step 1: Creating initial index ---');
    const hnsw1 = new HNSW({
      distanceFunction: 'cosine-normalized',
      m: 8,
      efConstruction: 100,
      useIndexedDB: true,
      clearOnInit: true // Start fresh
    });

    await hnsw1.ready();

    // Add some test data
    const testEmbeddings = [
      [0.1, 0.2, 0.3, 0.4, 0.5],
      [0.2, 0.3, 0.4, 0.5, 0.6],
      [0.3, 0.4, 0.5, 0.6, 0.7]
    ];

    for (let i = 0; i < testEmbeddings.length; i++) {
      await hnsw1.insert(`test-${i}`, testEmbeddings[i]);
    }

    console.log('Initial index created with', testEmbeddings.length, 'nodes');

    // Save the index
    await hnsw1.saveIndex();
    console.log('Index saved to IndexedDB');

    // Step 2: Simulate reload - create new instance and load persisted data
    console.log('\n--- Step 2: Simulating reload (loading persisted index) ---');
    const hnsw2 = new HNSW({
      distanceFunction: 'cosine-normalized',
      m: 8,
      efConstruction: 100,
      useIndexedDB: true,
      clearOnInit: false // Load persisted data
    });

    await hnsw2.ready();
    console.log('Reloaded index - graphLayers length:', hnsw2.graphLayers.length);
    console.log('Entry point:', hnsw2.entryPointKey);

    // Step 3: Try to insert a new node (this should trigger the failure)
    console.log('\n--- Step 3: Attempting insert operation (should trigger failure) ---');
    try {
      await hnsw2.insert('test-new', [0.4, 0.5, 0.6, 0.7, 0.8]);
      console.log('✅ Insert succeeded - no failure occurred');
    } catch (error) {
      console.error('❌ Insert failed with error:', error.message);
      console.error('Stack trace:', error.stack);
    }

  } catch (error) {
    console.error('Test setup failed:', error);
  }
}

// Run the test
testReloadFailure();