/**
 * Example usage of Flux-Vector library
 * 
 * This file demonstrates:
 * 1. Basic usage with default configuration
 * 2. Custom configuration
 * 3. Custom embedding engine implementation
 */

import VectorSearchManager, { DEFAULT_CONFIG, ISearchResult } from './embeddings/VectorSearchManager';
import { IEmbeddingEngine } from './embeddings/EmbeddingPipeline';

// ============================================
// Example 1: Basic Usage with Defaults
// ============================================
async function basicExample() {
  console.log('\n=== Example 1: Basic Usage ===\n');
  
  // Initialize with default configuration
  const searchManager = new VectorSearchManager();

  // Add some documents
  console.log('Adding documents...');
  await searchManager.addDocument("A small, fast boat is called a skiff.");
  await searchManager.addDocument("Apples and oranges are types of fruit.");
  await searchManager.addDocument("A car is a form of wheeled transport.");
  await searchManager.addDocument("The sky appears blue due to Rayleigh scattering.");
  await searchManager.addDocument("Dogs are domesticated mammals and popular pets.");

  // Check index size
  const size = await searchManager.size();
  console.log(`Total documents indexed: ${size}`);

  // Perform searches
  console.log('\nSearching for: "What is a vehicle?"');
  const results1 = await searchManager.search("What is a vehicle?", 3);
  displayResults(results1);

  console.log('\nSearching for: "Tell me about animals"');
  const results2 = await searchManager.search("Tell me about animals", 3);
  displayResults(results2);
}

// ============================================
// Example 2: Custom Configuration
// ============================================
async function customConfigExample() {
  console.log('\n=== Example 2: Custom Configuration ===\n');
  
  // Initialize with custom settings
  const searchManager = new VectorSearchManager({
    indexConfig: {
      distanceFunction: 'cosine',
      m: 32,                    // More connections for better recall
      efConstruction: 400,      // Higher quality index
      useIndexedDB: true,
    }
  });

  console.log('Using custom HNSW parameters: m=32, efConstruction=400');
  
  // Add documents
  await searchManager.addDocument("JavaScript is a programming language.");
  await searchManager.addDocument("Python is widely used for data science.");
  await searchManager.addDocument("TypeScript adds static typing to JavaScript.");

  // Search
  const results = await searchManager.search("coding languages", 2);
  displayResults(results);
}

// ============================================
// Example 3: Custom Embedding Engine
// ============================================

/**
 * Example custom embedding engine.
 * In production, this would connect to an API or use a local model.
 * This is a mock implementation for demonstration purposes.
 */
class MockCustomEmbeddingEngine implements IEmbeddingEngine {
  async embed(text: string): Promise<number[]> {
    console.log(`[CustomEngine] Embedding text: "${text.substring(0, 30)}..."`);
    
    // In a real implementation, this would:
    // 1. Call an API (OpenAI, Cohere, etc.)
    // 2. Use a local ONNX model
    // 3. Use another transformers model
    
    // For demo purposes, generate a random normalized vector
    const dimension = 384; // Match the default model's dimension
    const vector = Array.from({ length: dimension }, () => Math.random() - 0.5);
    
    // Normalize the vector
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    return vector.map(val => val / magnitude);
  }
}

async function customEmbeddingExample() {
  console.log('\n=== Example 3: Custom Embedding Engine ===\n');
  
  // Initialize with custom embedding engine
  const searchManager = new VectorSearchManager({
    embeddingEngine: new MockCustomEmbeddingEngine(),
    indexConfig: {
      distanceFunction: 'cosine-normalized', // Important: match your embeddings
    }
  });

  console.log('Using custom embedding engine');
  
  // Add documents
  await searchManager.addDocument("Machine learning models learn from data.");
  await searchManager.addDocument("Neural networks are inspired by the brain.");
  
  // Search
  const results = await searchManager.search("AI and deep learning", 2);
  displayResults(results);
}

// ============================================
// Helper Functions
// ============================================

function displayResults(results: ISearchResult[]) {
  if (results.length === 0) {
    console.log('No results found.');
    return;
  }

  console.log('\nResults:');
  results.forEach((result, index) => {
    const similarity = (1 - result.distance) * 100; // Convert to percentage
    console.log(`${index + 1}. [${similarity.toFixed(1)}% similar] ${result.text}`);
    console.log(`   ID: ${result.key}`);
  });
}

// ============================================
// Run Examples
// ============================================

async function main() {
  console.log('Flux-Vector Examples');
  console.log('====================');
  
  try {
    // Run all examples
    await basicExample();
    await customConfigExample();
    await customEmbeddingExample();
    
    console.log('\n=== All examples completed successfully! ===\n');
  } catch (error) {
    console.error('Error running examples:', error);
  }
}

// Execute if run directly
if (require.main === module) {
  main();
}

export { basicExample, customConfigExample, customEmbeddingExample };
