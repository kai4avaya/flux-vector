// VectorSearchManager.ts
import { Mememo } from "../mememo/src/mememo";
import { IEmbeddingEngine, DefaultEmbeddingEngine } from "./EmbeddingPipeline";
import { ISummarizationEngine, DefaultSummarizationEngine, SummarizationOptions } from "./SummarizationPipeline";
import { ContentStore, IDocument, ISummary } from "./ContentStore";
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
 * Interface for a summary search result.
 */
export interface ISummarySearchResult {
  documentId: string;
  summaryText: string;
  distance: number;
  similarity: number;
  document?: IDocument; // Full document if requested
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

  /**
   * Summarization configuration
   */
  summarization?: {
    /** Whether summarization is enabled. Default: false */
    enabled?: boolean;
    /** Custom summarization engine. If not provided, uses default. */
    engine?: ISummarizationEngine;
    /** Default summarization options */
    options?: SummarizationOptions;
    /** Whether to embed summaries after generation. Default: true */
    embedSummary?: boolean;
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
  private summarizationEngine?: ISummarizationEngine;
  private summarizationEnabled: boolean;
  private summarizationOptions?: SummarizationOptions;
  private embedSummary: boolean;
  private initPromise: Promise<void>;

  constructor(config?: VectorSearchConfig) {
    // Merge user config with defaults
    const finalConfig = {
      embeddingEngine: config?.embeddingEngine || new DefaultEmbeddingEngine(),
      indexConfig: {
        ...DEFAULT_CONFIG.indexConfig,
        ...config?.indexConfig,
      },
      summarization: {
        enabled: config?.summarization?.enabled ?? false,
        engine: config?.summarization?.engine,
        options: config?.summarization?.options,
        embedSummary: config?.summarization?.embedSummary ?? true,
      },
    };

    this.contentStore = new ContentStore();
    this.embeddingEngine = finalConfig.embeddingEngine!;
    
    // Setup summarization
    this.summarizationEnabled = finalConfig.summarization.enabled;
    this.summarizationOptions = finalConfig.summarization.options;
    this.embedSummary = finalConfig.summarization.embedSummary;
    if (this.summarizationEnabled) {
      this.summarizationEngine = finalConfig.summarization.engine || new DefaultSummarizationEngine();
    }

    // Initialize Mememo (HNSW)
    this.index = new Mememo({
      distanceFunction: finalConfig.indexConfig.distanceFunction,
      m: finalConfig.indexConfig.m,
      efConstruction: finalConfig.indexConfig.efConstruction,
      useIndexedDB: finalConfig.indexConfig.useIndexedDB,
    });

    // Logging removed for cleaner test output
    // console.log("Vector Search Manager initialized with config:", finalConfig.indexConfig);
    
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
   * Optionally generates and stores a summary in parallel.
   * @param text The text content of the document.
   * @param id The document ID (unique identifier). If not provided, a UUID will be generated.
   * @param metadata Optional metadata to store with the document.
   * @param progressCallback Optional callback to track embedding progress (0-1).
   * @param options Optional options for this specific document.
   */
  async addDocument(
    text: string, 
    id?: string, 
    metadata?: Record<string, any>,
    progressCallback?: (progress: number) => void,
    options?: {
      generateSummary?: boolean; // Override config default
      waitForSummary?: boolean; // Wait for summary before returning (default: false)
    }
  ): Promise<{
    documentId: string;
    summaryId?: string; // If summary was generated
  }> {
    // Logging removed for cleaner test output
    // console.log(`Embedding document: "${text.substring(0, 20)}..."`);

    // Generate or use provided key
    const key: string = id || uuidv4();
    
    // Determine if we should generate summary
    const shouldGenerateSummary = options?.generateSummary ?? this.summarizationEnabled;
    const waitForSummary = options?.waitForSummary ?? false;

    // 1. Start embedding in parallel with summarization (if enabled)
    const embeddingPromise = this.embeddingEngine.embed(text, progressCallback);
    
    let summaryPromise: Promise<string> | null = null;
    if (shouldGenerateSummary && this.summarizationEngine) {
      summaryPromise = this.summarizationEngine.summarize(
        text,
        this.summarizationOptions
      );
    }

    // 2. Wait for embedding to complete
    const vector: number[] = await embeddingPromise;

    // 3. Store the original text with metadata
    await this.contentStore.addDocument(key, text, metadata);

    // 4. Insert the vector into the HNSW index with the same key
    await this.index.insert(key, vector);

    // Logging removed for cleaner test output
    // console.log(`Successfully added document with key: ${key}`);

    // 5. Handle summary generation (in parallel or wait)
    let summaryId: string | undefined;
    if (summaryPromise) {
      if (waitForSummary) {
        // Wait for summary before returning
        const summaryText = await summaryPromise;
        summaryId = await this._storeSummary(key, summaryText);
      } else {
        // Don't wait - process summary asynchronously
        summaryPromise
          .then((summaryText) => this._storeSummary(key, summaryText))
          .catch((error) => {
            console.error(`Failed to generate summary for document ${key}:`, error);
          });
      }
    }

    return {
      documentId: key,
      summaryId,
    };
  }

  /**
   * Internal method to store a summary and optionally embed it
   */
  private async _storeSummary(documentId: string, summaryText: string): Promise<string> {
    // Store summary in ContentStore
    const summary: ISummary = {
      id: documentId,
      documentId,
      summaryText,
      summaryEmbedding: [], // Will be populated if embedSummary is true
      model: this.summarizationOptions?.model || 'Xenova/distilbart-cnn-6-6',
      createdAt: Date.now(),
    };

    // Embed summary if enabled
    if (this.embedSummary) {
      try {
        const summaryVector = await this.embeddingEngine.embed(summaryText);
        summary.summaryEmbedding = summaryVector;
        
        // Store summary embedding in index with prefix
        await this.index.insert(`summary:${documentId}`, summaryVector);
      } catch (error) {
        console.error(`Failed to embed summary for document ${documentId}:`, error);
        // Continue without embedding
      }
    }

    // Store summary in ContentStore
    await this.contentStore.addSummary(summary);
    
    return documentId;
  }

  /**
   * Searches the vector index for the k most similar documents.
   * Excludes summary embeddings from results.
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

    // 3. Query the HNSW index (request more results to account for filtering)
    const results = await this.index.query(queryVector, k * 2); // Get extra to filter summaries

    // 4. Filter out summary keys (keys starting with "summary:")
    const documentKeys = results.keys.filter(key => !key.startsWith('summary:'));
    const documentDistances = results.distances.slice(0, documentKeys.length);

    // 5. Retrieve the original content
    const documents: (IDocument | undefined)[] =
      await this.contentStore.getDocuments(documentKeys);

    // 6. Combine and return the results (limit to k)
    const combinedResults = documents
      .slice(0, k)
      .map((doc, i) => {
        // Handle cases where a key might be in the index
        // but its content was somehow not found.
        if (!doc) {
          return null;
        }
        
        const distance = documentDistances[i];
        // Convert distance to similarity score (0-1, where 1 is perfect match)
        // For cosine distance: similarity = 1 - distance
        const similarity = 1 - distance;
        
        return {
          key: documentKeys[i],
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
   * Search for similar summaries (not documents).
   * Returns documents that have summaries matching the query.
   * @param queryText The search query.
   * @param k The number of results to return. Default: 3
   */
  async searchSummaries(
    queryText: string,
    k: number = 3
  ): Promise<ISummarySearchResult[]> {
    // Logging removed for cleaner test output
    // console.log(`Searching summaries for query: "${queryText}"`);

    // 1. Embed the query text
    const queryVector: number[] = await this.embeddingEngine.embed(queryText);

    // 2. Check if index is empty
    const indexSize = await this.size();
    if (indexSize === 0) {
      console.log('Index is empty, returning no results');
      return [];
    }

    // 3. Query the HNSW index (request more results to account for filtering)
    const results = await this.index.query(queryVector, k * 2);

    // 4. Filter to only summary keys (keys starting with "summary:")
    const summaryKeys = results.keys.filter(key => key.startsWith('summary:'));
    const summaryDistances = results.distances.slice(0, summaryKeys.length);

    if (summaryKeys.length === 0) {
      return [];
    }

    // 5. Extract document IDs from summary keys
    const documentIds = summaryKeys.map(key => key.replace('summary:', ''));

    // 6. Retrieve summaries and documents
    const summaries = await this.contentStore.getSummaries(documentIds);
    const documents = await this.contentStore.getDocuments(documentIds);

    // 7. Combine and return results (limit to k)
    const combinedResults: ISummarySearchResult[] = [];
    for (let i = 0; i < Math.min(k, summaryKeys.length); i++) {
      const summary = summaries[i];
      const document = documents[i];
      
      if (!summary) {
        continue; // Skip if summary not found
      }

      const distance = summaryDistances[i];
      const similarity = 1 - distance;

      combinedResults.push({
        documentId: documentIds[i],
        summaryText: summary.summaryText,
        distance,
        similarity,
        document: document,
        metadata: summary.metadata,
      });
    }

    return combinedResults;
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
   * Get summary for a specific document.
   * @param documentId The document ID.
   * @returns The summary if found, undefined otherwise.
   */
  async getSummary(documentId: string): Promise<ISummary | undefined> {
    return await this.contentStore.getSummary(documentId);
  }

  /**
   * Generate a summary for an existing document.
   * @param documentId The document ID.
   * @param options Optional summarization options.
   * @returns The generated summary text.
   */
  async generateSummary(
    documentId: string,
    options?: SummarizationOptions
  ): Promise<string> {
    // Get document
    const doc = await this.getDocument(documentId);
    if (!doc) {
      throw new Error(`Document ${documentId} not found`);
    }

    // Get or create summarization engine
    if (!this.summarizationEngine) {
      this.summarizationEngine = new DefaultSummarizationEngine();
    }

    // Generate summary
    const summaryText = await this.summarizationEngine.summarize(
      doc.text,
      options || this.summarizationOptions
    );

    // Store summary
    await this._storeSummary(documentId, summaryText);

    return summaryText;
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
