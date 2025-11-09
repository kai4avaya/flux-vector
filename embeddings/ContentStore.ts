 // ContentStore.ts
import Dexie, { Table } from "dexie";

/**
 * Interface for the document we are storing.
 */
export interface IDocument {
  id: string;   // The unique ID (string)
  text: string; // The original text content
  metadata?: Record<string, any>; // Optional metadata
}

/**
 * Interface for document summaries.
 */
export interface ISummary {
  id: string; // Same as document id (primary key)
  documentId: string; // Foreign key reference to documents.id
  summaryText: string;
  summaryEmbedding: number[]; // Embedding of the summary
  model: string; // Model used for summarization
  createdAt: number; // Timestamp
  metadata?: Record<string, any>;
}

export class ContentStore extends Dexie {
  /**
   * Defines the 'documents' table with an 'id' primary key.
   */
  documents: Table<IDocument, string>; // <Type, KeyType>

  /**
   * Defines the 'summaries' table with an 'id' primary key.
   */
  summaries: Table<ISummary, string>; // <Type, KeyType>

  constructor() {
    super("MyContentDatabase");
    
    // Version 1: Initial schema with documents only
    this.version(1).stores({
      // We use 'id' as the primary key, not '++id',
      // because we supply our own UUID string.
      documents: "id, text",
    });
    
    // Version 2: Add summaries table
    this.version(2).stores({
      documents: "id, text",
      summaries: "id, documentId, createdAt",
    }).upgrade(async (tx) => {
      // Migration: No data migration needed, just schema update
      console.log('Upgrading ContentStore to version 2: Added summaries table');
    });
    
    this.documents = this.table("documents");
    this.summaries = this.table("summaries");
  }

  /**
   * Add or replace a document in the store.
   * @param id The unique string key.
   * @param text The text content.
   * @param metadata Optional metadata to store with the document.
   */
  async addDocument(id: string, text: string, metadata?: Record<string, any>): Promise<string> {
    return await this.documents.put({ id, text, metadata });
  }

  /**
   * Update an existing document in the store.
   * This is an alias for addDocument since put() handles both insert and update.
   * @param id The unique string key.
   * @param text The new text content.
   */
  async updateDocument(id: string, text: string): Promise<string> {
    return await this.addDocument(id, text);
  }

  /**
   * Delete a document from the store.
   * @param id The unique string key to delete.
   */
  async deleteDocument(id: string): Promise<void> {
    await this.documents.delete(id);
  }

  /**
   * Get a single document by its key.
   * @param id The document ID.
   */
  async getDocument(id: string): Promise<IDocument | undefined> {
    return await this.documents.get(id);
  }

  /**
   * Get a batch of documents by their keys.
   * @param keys An array of string keys.
   */
  async getDocuments(keys: string[]): Promise<(IDocument | undefined)[]> {
    return await this.documents.bulkGet(keys);
  }

  /**
   * Get all documents in the store.
   */
  async getAllDocuments(): Promise<IDocument[]> {
    return await this.documents.toArray();
  }

  /**
   * Count the total number of documents in the store.
   */
  async count(): Promise<number> {
    return await this.documents.count();
  }

  /**
   * Clear all documents from the store.
   */
  async clear(): Promise<void> {
    await this.documents.clear();
    await this.summaries.clear();
  }

  // ========== Summary Methods ==========

  /**
   * Add or replace a summary in the store.
   * @param summary The summary object to store.
   */
  async addSummary(summary: ISummary): Promise<string> {
    return await this.summaries.put(summary);
  }

  /**
   * Get a summary by document ID.
   * @param documentId The document ID to get the summary for.
   */
  async getSummary(documentId: string): Promise<ISummary | undefined> {
    return await this.summaries.get(documentId);
  }

  /**
   * Update an existing summary.
   * @param documentId The document ID.
   * @param updates Partial summary object with fields to update.
   */
  async updateSummary(
    documentId: string,
    updates: Partial<Omit<ISummary, 'id' | 'documentId'>>
  ): Promise<void> {
    const existing = await this.summaries.get(documentId);
    if (!existing) {
      throw new Error(`Summary not found for document: ${documentId}`);
    }
    await this.summaries.update(documentId, updates);
  }

  /**
   * Delete a summary from the store.
   * @param documentId The document ID to delete the summary for.
   */
  async deleteSummary(documentId: string): Promise<void> {
    await this.summaries.delete(documentId);
  }

  /**
   * Get summaries for multiple documents.
   * @param documentIds Array of document IDs.
   */
  async getSummaries(documentIds: string[]): Promise<(ISummary | undefined)[]> {
    return await this.summaries.bulkGet(documentIds);
  }

  /**
   * Get all summaries in the store.
   */
  async getAllSummaries(): Promise<ISummary[]> {
    return await this.summaries.toArray();
  }

  /**
   * Count the total number of summaries in the store.
   */
  async countSummaries(): Promise<number> {
    return await this.summaries.count();
  }
}
