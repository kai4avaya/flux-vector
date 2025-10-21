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

export class ContentStore extends Dexie {
  /**
   * Defines the 'documents' table with an 'id' primary key.
   */
  documents: Table<IDocument, string>; // <Type, KeyType>

  constructor() {
    super("MyContentDatabase");
    this.version(1).stores({
      // We use 'id' as the primary key, not '++id',
      // because we supply our own UUID string.
      documents: "id, text",
    });
    this.documents = this.table("documents");
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
  }
}
