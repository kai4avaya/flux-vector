/**
 * Mock Embedding Engine for Testing
 * Provides deterministic embeddings without requiring actual ML models
 */

import { IEmbeddingEngine } from '../../embeddings/EmbeddingPipeline';

/**
 * Simple mock embedding engine that generates deterministic vectors
 * based on text content for testing purposes.
 */
export class MockEmbeddingEngine implements IEmbeddingEngine {
  private dimensions: number;

  constructor(dimensions: number = 384) {
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    // Generate deterministic vector based on text
    const vector: number[] = [];
    
    // Use text properties to create a unique but deterministic embedding
    const hash = this.simpleHash(text);
    
    for (let i = 0; i < this.dimensions; i++) {
      // Create deterministic values between -1 and 1
      const seed = hash + i;
      const value = Math.sin(seed) * Math.cos(seed * 0.5);
      vector.push(value);
    }
    
    // Normalize the vector for cosine similarity
    return this.normalize(vector);
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash;
  }

  private normalize(vector: number[]): number[] {
    const magnitude = Math.sqrt(
      vector.reduce((sum, val) => sum + val * val, 0)
    );
    return vector.map(val => val / magnitude);
  }
}

/**
 * Even simpler mock that returns the same vector for the same text
 */
export class SimpleMockEmbedding implements IEmbeddingEngine {
  private cache: Map<string, number[]> = new Map();
  private dimensions: number;
  private counter: number = 0;

  constructor(dimensions: number = 10) {
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    if (this.cache.has(text)) {
      return this.cache.get(text)!;
    }

    // Create a simple vector
    const vector = Array(this.dimensions).fill(0).map((_, i) => {
      return Math.sin(this.counter + i) * 0.5;
    });

    this.counter++;
    this.cache.set(text, vector);
    return vector;
  }
}
