// VectorSearchManager.ts
import { Mememo } from "../mememo/src/mememo";
import { IEmbeddingEngine, DefaultEmbeddingEngine } from "./EmbeddingPipeline";
import { ContentStore, IDocument } from "./ContentStore";
import { v4 as uuidv4 } from "uuid";

/**
 * Interface for a single search result.
 */
export interface ISearchResult {
  key: string;
  text: string;
  distance: number;
  similarity: number;
  metadata?: Record<string, any>;
}

/**
 * Configuration options for VectorSearchManager.
 */
export interface VectorSearchConfig {
  /**
   * Custom embedding engine. If not provided, uses the default HuggingFace model.
   */
  embeddingEngine?: IEmbeddingEngine;
  
  /**
   * HNSW index configuration.
   */
  indexConfig?: {
    /** Distance function type. Default: 'cosine-normalized' */
    distanceFunction?: 'cosine' | 'cosine-normalized';
    /** Number of bi-directional links per node. Default: 16 */
    m?: number;
    /** Size of dynamic candidate list during construction. Default: 200 */
    efConstruction?: number;
    /** Whether to use IndexedDB for persistence. Default: true */
    useIndexedDB?: boolean;
  };
}

/**
 * Default configuration for VectorSearchManager.
 * Note: embeddingEngine is created lazily to avoid loading ONNX at module load time
 */
export const DEFAULT_CONFIG: Omit<VectorSearchConfig, 'embeddingEngine'> & { embeddingEngine?: IEmbeddingEngine } = {
  indexConfig: {
    distanceFunction: 'cosine-normalized',
    m: 16,
    efConstruction: 200,
    useIndexedDB: true,
  }
};

class VectorSearchManager {
  public contentStore: ContentStore;
  public index: Mememo;
  private embeddingEngine: IEmbeddingEngine;
  private initPromise: Promise<void>;

  constructor(config?: VectorSearchConfig) {
    // Merge user config with defaults
    const finalConfig = {
      embeddingEngine: config?.embeddingEngine || new DefaultEmbeddingEngine(),
      indexConfig: {
        ...DEFAULT_CONFIG.indexConfig,
        ...config?.indexConfig,
      }
    };

    this.contentStore = new ContentStore();
    this.embeddingEngine = finalConfig.embeddingEngine!;

    // Initialize Mememo (HNSW)
    this.index = new Mememo({
      distanceFunction: finalConfig.indexConfig.distanceFunction,
      m: finalConfig.indexConfig.m,
      efConstruction: finalConfig.indexConfig.efConstruction,
      useIndexedDB: finalConfig.indexConfig.useIndexedDB,
    });

    console.log("Vector Search Manager initialized with config:", finalConfig.indexConfig);
    
    // Wait for async initialization to complete
    this.initPromise = this._initialize();
  }

  /**
   * Wait for the index to be fully initialized (loads persisted data if available).
   * Call this before performing any operations if you want to ensure data is loaded.
   */
  async ready(): Promise<void> {
    await this.initPromise;
  }

  /**
   * Internal initialization - loads persisted index if available.
   */
  private async _initialize(): Promise<void> {
    if (this.index.useIndexedDB) {
      const persistedIndex = await this.index.loadPersistedIndex();
      if (persistedIndex) {
        this.index.loadIndex(persistedIndex);
        console.log('Loaded persisted index from IndexedDB');
      }
    }
  }

  /**
   * Adds a new document to both the content store and the vector index.
   * @param text The text content of the document.
   * @param id The document ID (unique identifier). If not provided, a UUID will be generated.
   * @param metadata Optional metadata to store with the document.
   * @param progressCallback Optional callback to track embedding progress (0-1).
   */
  async addDocument(
    text: string, 
    id?: string, 
    metadata?: Record<string, any>,
    progressCallback?: (progress: number) => void
  ): Promise<string> {
    console.log(`Embedding document: "${text.substring(0, 20)}..."`);

    // 1. Use the configured embedding engine to create the embedding
    const vector: number[] = await this.embeddingEngine.embed(text, progressCallback);

    // 2. Generate or use provided key
    const key: string = id || uuidv4();

    // 3. Store the original text with metadata
    await this.contentStore.addDocument(key, text, metadata);

    // 4. Insert the vector into the HNSW index with the same key
    await this.index.insert(key, vector);

    console.log(`Successfully added document with key: ${key}`);
    return key;
  }

  /**
   * Searches the vector index for the k most similar documents.
   * @param queryText The search query.
   * @param k The number of results to return. Default: 3
   */
  async search(queryText: string, k: number = 3): Promise<ISearchResult[]> {
    console.log(`Embedding query: "${queryText}"`);

    // 1. Embed the query text using the configured embedding engine
    const queryVector: number[] = await this.embeddingEngine.embed(queryText);

    // 2. Check if index is empty
    const indexSize = await this.size();
    if (indexSize === 0) {
      console.log('Index is empty, returning no results');
      return [];
    }

    // 3. Query the HNSW index
    const results = await this.index.query(queryVector, k);

    // 4. Retrieve the original content
    // The query method returns { keys: string[], distances: number[] }
    const documentIds = results.keys;
    const documents: (IDocument | undefined)[] =
      await this.contentStore.getDocuments(documentIds);

    // 5. Combine and return the results
    const combinedResults = documents
      .map((doc, i) => {
        // Handle cases where a key might be in the index
        // but its content was somehow not found.
        if (!doc) {
          return null;
        }
        
        const distance = results.distances[i];
        // Convert distance to similarity score (0-1, where 1 is perfect match)
        // For cosine distance: similarity = 1 - distance
        const similarity = 1 - distance;
        
        return {
          key: results.keys[i],
          text: doc.text,
          distance: distance, // (0 = perfect match, 1 = opposite)
          similarity: similarity, // (1 = perfect match, 0 = opposite)
          metadata: doc.metadata,
        };
      })
      .filter(Boolean); // Filter out any null entries

    return combinedResults as ISearchResult[];
  }

  /**
   * Get the total number of indexed documents.
   */
  async size(): Promise<number> {
    // HNSW uses nodes.size() to get the count
    return await this.index.nodes.size();
  }

  /**
   * Delete a document from both the content store and the vector index.
   * This performs a soft delete - the node is marked as deleted but remains in memory.
   * Use compactIndex() to perform a hard delete and reclaim memory.
   * @param id The document ID to delete.
   */
  async deleteDocument(id: string): Promise<void> {
    console.log(`Deleting document: ${id}`);

    // 1. Check if document exists in content store
    const docs = await this.contentStore.getDocuments([id]);
    if (!docs[0]) {
      throw new Error(`Document ${id} not found`);
    }

    // 2. Mark as deleted in HNSW index (soft delete)
    await this.index.markDeleted(id);

    // 3. Remove from content store
    await this.contentStore.documents.delete(id);

    console.log(`Successfully deleted document: ${id}`);
  }

  /**
   * Update an existing document with new text content.
   * This will re-embed the text and update the vector in the index.
   * @param id The document ID to update.
   * @param newText The new text content.
   */
  async updateDocument(id: string, newText: string): Promise<void> {
    console.log(`Updating document: ${id}`);

    // 1. Check if document exists
    const docs = await this.contentStore.getDocuments([id]);
    if (!docs[0]) {
      throw new Error(`Document ${id} not found. Use addDocument() instead.`);
    }

    // 2. Generate new embedding
    const newVector: number[] = await this.embeddingEngine.embed(newText);

    // 3. Update the vector in HNSW index
    await this.index.update(id, newVector);

    // 4. Update the text in content store
    await this.contentStore.addDocument(id, newText);

    console.log(`Successfully updated document: ${id}`);
  }

  /**
   * Compact the index by removing all soft-deleted nodes.
   * This rebuilds the index with only active documents, reclaiming memory.
   * Warning: This operation is expensive (O(n log n)) and should be used sparingly.
   */
  async compactIndex(): Promise<void> {
    console.log('Starting index compaction...');

    // 1. Get all node keys from the index
    const allKeys = await this.index.nodes.keys();
    console.log(`Total nodes before compaction: ${allKeys.length}`);

    // 2. Collect all non-deleted nodes with their vectors
    const activeNodes: Array<{ key: string; value: number[] }> = [];
    
    for (const key of allKeys) {
      const node = await this.index.nodes.get(key, 0);
      if (node && !node.isDeleted) {
        activeNodes.push({ key: node.key, value: node.value });
      }
    }

    console.log(`Active nodes after filtering: ${activeNodes.length}`);

    // If no active nodes, just clear and return
    if (activeNodes.length === 0) {
      await this.index.clear();
      console.log(`Index compaction complete. Nodes after: 0`);
      return;
    }

    // 3. Create a new HNSW instance with the same configuration
    const config: any = {
      distanceFunction: this.index.distanceFunction,
      m: this.index.m,
      efConstruction: this.index.efConstruction,
      useIndexedDB: this.index.useIndexedDB,
      seed: this.index.seed,
    };

    // Store reference to old index
    const oldIndex = this.index;

    // Create new index
    this.index = new Mememo(config);

    // 4. Re-insert all active nodes into the new index
    for (const node of activeNodes) {
      await this.index.insert(node.key, node.value);
    }

    // 5. Clear the old index to free memory
    await oldIndex.clear();

    console.log(`Index compaction complete. Nodes after: ${await this.size()}`);
  }

  /**
   * Get information about a specific document.
   * @param id The document ID.
   * @returns The document if found, undefined otherwise.
   */
  async getDocument(id: string): Promise<IDocument | undefined> {
    const docs = await this.contentStore.getDocuments([id]);
    return docs[0];
  }

  /**
   * Check if a document exists and is not deleted.
   * @param id The document ID.
   */
  async hasDocument(id: string): Promise<boolean> {
    // Check if exists in content store
    const doc = await this.getDocument(id);
    if (!doc) return false;

    // Check if not soft-deleted in index
    const node = await this.index.nodes.get(id, 0);
    return node ? !node.isDeleted : false;
  }

  /**
   * Get statistics about the index.
   */
  async getStats(): Promise<{
    totalNodes: number;
    activeNodes: number;
    deletedNodes: number;
  }> {
    const allKeys = await this.index.nodes.keys();
    let deletedCount = 0;

    for (const key of allKeys) {
      const node = await this.index.nodes.get(key, 0);
      if (node?.isDeleted) {
        deletedCount++;
      }
    }

    return {
      totalNodes: allKeys.length,
      activeNodes: allKeys.length - deletedCount,
      deletedNodes: deletedCount,
    };
  }
}

export default VectorSearchManager;
