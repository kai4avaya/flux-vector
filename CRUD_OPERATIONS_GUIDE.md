# CRUD Operations Guide

This guide covers Create, Read, Update, and Delete operations for documents in the Vector Search Manager.

## Table of Contents
- [Overview](#overview)
- [Create Operations](#create-operations)
- [Read Operations](#read-operations)
- [Update Operations](#update-operations)
- [Delete Operations](#delete-operations)
- [Index Maintenance](#index-maintenance)
- [Best Practices](#best-practices)
- [Examples](#examples)

## Overview

The VectorSearchManager now supports full CRUD operations on indexed documents:

- **Create**: Add new documents with embeddings
- **Read**: Retrieve documents and search by similarity
- **Update**: Modify existing documents and re-embed
- **Delete**: Remove documents (soft or hard delete)

### Architecture

```
┌─────────────────────────────────────┐
│   VectorSearchManager               │
├─────────────────────────────────────┤
│  - Document Management              │
│  - Embedding Generation             │
│  - CRUD Operations                  │
└────────────┬────────────────────────┘
             │
    ┌────────┴────────┐
    │                 │
┌───▼───────┐  ┌──────▼──────┐
│ContentStore│  │ HNSW Index  │
│  (Dexie)   │  │  (Mememo)   │
│            │  │             │
│ Text       │  │ Vectors     │
│ Storage    │  │ & Graph     │
└────────────┘  └─────────────┘
```

## Create Operations

### Basic Document Addition

```typescript
const manager = new VectorSearchManager();

// Add a document (auto-generated ID)
const id = await manager.addDocument('My document text');

// Add a document with custom ID
const customId = await manager.addDocument('Custom document', 'my-custom-id');
```

### Batch Addition

```typescript
const documents = [
  'First document about machine learning',
  'Second document about neural networks',
  'Third document about deep learning'
];

const ids = [];
for (const doc of documents) {
  ids.push(await manager.addDocument(doc));
}
```

## Read Operations

### Get Document by ID

```typescript
// Retrieve a single document
const doc = await manager.getDocument(documentId);
if (doc) {
  console.log(doc.text);
}
```

### Check Document Existence

```typescript
// Check if document exists and is active (not deleted)
const exists = await manager.hasDocument(documentId);
```

### Search by Similarity

```typescript
// Search for similar documents
const results = await manager.search('machine learning', 5);
results.forEach(result => {
  console.log(`${result.key}: ${result.text} (distance: ${result.distance})`);
});
```

### Get Index Statistics

```typescript
const stats = await manager.getStats();
console.log(`Total nodes: ${stats.totalNodes}`);
console.log(`Active nodes: ${stats.activeNodes}`);
console.log(`Deleted nodes: ${stats.deletedNodes}`);
```

## Update Operations

### Update Document Text

```typescript
// Update existing document
await manager.updateDocument(documentId, 'Updated text content');

// The embedding is automatically regenerated
// Search results will reflect the new content
```

### Update Workflow

1. **Validates** document exists
2. **Generates** new embedding for updated text
3. **Updates** vector in HNSW index
4. **Updates** text in ContentStore

```typescript
try {
  await manager.updateDocument('my-doc-id', 'New content');
  console.log('Document updated successfully');
} catch (error) {
  console.error('Document not found:', error.message);
}
```

## Delete Operations

### Soft Delete (Recommended)

Soft delete marks documents as deleted but keeps them in memory. This is fast (O(1)) but doesn't reclaim memory immediately.

```typescript
// Delete a document (soft delete)
await manager.deleteDocument(documentId);

// Document is:
// - Removed from ContentStore
// - Marked as deleted in HNSW (excluded from searches)
// - Still occupies memory until compaction
```

### Hard Delete (via Compaction)

Hard delete physically removes deleted nodes from the index, reclaiming memory. This is expensive (O(n log n)) but necessary for long-running applications.

```typescript
// Perform hard delete by compacting the index
await manager.compactIndex();

// After compaction:
// - All soft-deleted nodes are removed
// - Memory is reclaimed
// - Index is rebuilt with only active nodes
```

### Delete Workflow

```typescript
// 1. Delete several documents (soft delete)
await manager.deleteDocument(id1);
await manager.deleteDocument(id2);
await manager.deleteDocument(id3);

// 2. Check statistics
const statsBefore = await manager.getStats();
console.log(`Deleted nodes: ${statsBefore.deletedNodes}`);

// 3. Compact to reclaim memory (hard delete)
await manager.compactIndex();

// 4. Verify cleanup
const statsAfter = await manager.getStats();
console.log(`Deleted nodes: ${statsAfter.deletedNodes}`); // Should be 0
```

## Index Maintenance

### When to Compact

Compact the index when:
- Deleted nodes exceed 20-30% of total nodes
- Memory usage is a concern
- Application is idle (compaction is expensive)
- Before persisting to IndexedDB

```typescript
// Periodic compaction strategy
async function periodicMaintenance(manager: VectorSearchManager) {
  const stats = await manager.getStats();
  const deletionRatio = stats.deletedNodes / stats.totalNodes;
  
  if (deletionRatio > 0.25) {
    console.log('Compacting index...');
    await manager.compactIndex();
    console.log('Compaction complete');
  }
}
```

### Monitoring Index Health

```typescript
async function monitorIndexHealth(manager: VectorSearchManager) {
  const stats = await manager.getStats();
  
  return {
    totalDocuments: stats.totalNodes,
    activeDocuments: stats.activeNodes,
    deletedDocuments: stats.deletedNodes,
    deletionPercentage: ((stats.deletedNodes / stats.totalNodes) * 100).toFixed(2),
    needsCompaction: (stats.deletedNodes / stats.totalNodes) > 0.25
  };
}
```

## Best Practices

### 1. Use Meaningful IDs

```typescript
// Good: Descriptive IDs
const id = await manager.addDocument(text, 'user-123-profile');

// Avoid: Let UUIDs be auto-generated only when you don't need to reference them
const id = await manager.addDocument(text); // Auto-generated UUID
```

### 2. Batch Operations When Possible

```typescript
// Good: Process in batches
const documents = loadDocuments();
for (const doc of documents) {
  await manager.addDocument(doc.text, doc.id);
}

// Then compact once
if (needsCompaction) {
  await manager.compactIndex();
}

// Avoid: Compacting after every delete
await manager.deleteDocument(id1);
await manager.compactIndex(); // Too frequent!
```

### 3. Error Handling

```typescript
async function safeUpdate(manager: VectorSearchManager, id: string, text: string) {
  try {
    // Check if document exists first
    const exists = await manager.hasDocument(id);
    if (!exists) {
      console.log('Document does not exist, adding instead');
      return await manager.addDocument(text, id);
    }
    
    // Update existing document
    await manager.updateDocument(id, text);
    return id;
  } catch (error) {
    console.error('Operation failed:', error);
    throw error;
  }
}
```

### 4. Monitor Before Compaction

```typescript
async function smartCompact(manager: VectorSearchManager) {
  const stats = await manager.getStats();
  
  console.log(`Index status before compaction:`);
  console.log(`  Total nodes: ${stats.totalNodes}`);
  console.log(`  Active: ${stats.activeNodes}`);
  console.log(`  Deleted: ${stats.deletedNodes}`);
  
  if (stats.deletedNodes === 0) {
    console.log('No deleted nodes, skipping compaction');
    return;
  }
  
  await manager.compactIndex();
  
  const afterStats = await manager.getStats();
  console.log(`Compaction complete. Reclaimed ${stats.deletedNodes} nodes`);
  console.log(`  New total: ${afterStats.totalNodes}`);
}
```

### 5. Persistence Considerations

```typescript
// When using IndexedDB persistence
const manager = new VectorSearchManager({
  indexConfig: {
    useIndexedDB: true,
  }
});

// After bulk operations, persist changes
await manager.addDocument(doc1);
await manager.addDocument(doc2);
await manager.deleteDocument(oldId);
await manager.compactIndex();

// Changes are automatically persisted with IndexedDB
```

## Examples

### Example 1: Knowledge Base Management

```typescript
class KnowledgeBase {
  private manager: VectorSearchManager;
  
  constructor() {
    this.manager = new VectorSearchManager({
      indexConfig: {
        m: 16,
        efConstruction: 200,
        useIndexedDB: true,
      }
    });
  }
  
  async addArticle(title: string, content: string) {
    const articleId = `article-${Date.now()}`;
    await this.manager.addDocument(`${title}. ${content}`, articleId);
    return articleId;
  }
  
  async updateArticle(articleId: string, content: string) {
    await this.manager.updateDocument(articleId, content);
  }
  
  async deleteArticle(articleId: string) {
    await this.manager.deleteDocument(articleId);
  }
  
  async searchArticles(query: string, limit: number = 5) {
    return await this.manager.search(query, limit);
  }
  
  async maintenance() {
    const stats = await this.manager.getStats();
    if (stats.deletedNodes > stats.totalNodes * 0.2) {
      await this.manager.compactIndex();
    }
  }
}
```

### Example 2: Document Version Control

```typescript
class DocumentVersionManager {
  private manager: VectorSearchManager;
  private versions: Map<string, number>;
  
  constructor(manager: VectorSearchManager) {
    this.manager = manager;
    this.versions = new Map();
  }
  
  async createDocument(docId: string, content: string) {
    await this.manager.addDocument(content, docId);
    this.versions.set(docId, 1);
  }
  
  async updateDocument(docId: string, content: string) {
    // Update the document
    await this.manager.updateDocument(docId, content);
    
    // Increment version
    const version = this.versions.get(docId) || 0;
    this.versions.set(docId, version + 1);
    
    console.log(`Document ${docId} updated to version ${version + 1}`);
  }
  
  async getDocument(docId: string) {
    const doc = await this.manager.getDocument(docId);
    const version = this.versions.get(docId);
    
    return {
      ...doc,
      version
    };
  }
}
```

### Example 3: Batch Processing with Progress

```typescript
async function batchProcessDocuments(
  documents: Array<{id: string, text: string}>,
  manager: VectorSearchManager
) {
  console.log(`Processing ${documents.length} documents...`);
  
  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    await manager.addDocument(doc.text, doc.id);
    
    if ((i + 1) % 100 === 0) {
      console.log(`Processed ${i + 1}/${documents.length} documents`);
    }
  }
  
  console.log('All documents processed');
  
  // Optimize index after batch addition
  console.log('Optimizing index...');
  await manager.compactIndex();
  console.log('Optimization complete');
}
```

### Example 4: Safe Delete with Verification

```typescript
async function safeDeleteDocument(
  manager: VectorSearchManager,
  documentId: string
) {
  // 1. Verify document exists
  const exists = await manager.hasDocument(documentId);
  if (!exists) {
    throw new Error(`Document ${documentId} not found or already deleted`);
  }
  
  // 2. Get document for logging
  const doc = await manager.getDocument(documentId);
  console.log(`Deleting document: ${doc?.text.substring(0, 50)}...`);
  
  // 3. Delete
  await manager.deleteDocument(documentId);
  
  // 4. Verify deletion
  const stillExists = await manager.hasDocument(documentId);
  if (stillExists) {
    throw new Error('Deletion failed - document still exists');
  }
  
  console.log(`Document ${documentId} successfully deleted`);
  
  // 5. Check if compaction is needed
  const stats = await manager.getStats();
  if (stats.deletedNodes > 10 && stats.deletedNodes / stats.totalNodes > 0.3) {
    console.log('Compaction recommended');
  }
}
```

## Performance Characteristics

| Operation | Time Complexity | Notes |
|-----------|----------------|-------|
| Add Document | O(log n) | Includes embedding generation + HNSW insertion |
| Update Document | O(log n) | Re-embedding + update connections in graph |
| Soft Delete | O(1) | Just marks node as deleted |
| Hard Delete (Compact) | O(n log n) | Rebuilds entire index |
| Get Document | O(1) | Direct lookup in ContentStore |
| Search | O(log n) | HNSW approximate nearest neighbor search |
| Get Stats | O(n) | Iterates through all nodes |

## Troubleshooting

### Issue: "Document not found" on Update

```typescript
// Problem: Trying to update non-existent document
await manager.updateDocument('missing-id', 'text'); // Error!

// Solution: Check existence first
if (await manager.hasDocument(documentId)) {
  await manager.updateDocument(documentId, 'text');
} else {
  await manager.addDocument('text', documentId);
}
```

### Issue: High Memory Usage

```typescript
// Problem: Too many soft-deleted nodes
const stats = await manager.getStats();
console.log(`Wasting ${stats.deletedNodes} nodes in memory`);

// Solution: Compact the index
await manager.compactIndex();
```

### Issue: Slow Compaction

```typescript
// Problem: Compacting too frequently
// Solution: Only compact when necessary
async function intelligentCompaction(manager: VectorSearchManager) {
  const stats = await manager.getStats();
  
  // Only compact if >25% are deleted AND >100 deleted nodes
  if (stats.deletedNodes > 100 && 
      stats.deletedNodes / stats.totalNodes > 0.25) {
    await manager.compactIndex();
  }
}
```

## Related Documentation

- [Integration Guide](./INTEGRATION_GUIDE.md) - Full system integration
- [Persistence Guide](./PERSISTENCE_GUIDE.md) - IndexedDB persistence
- [Quick Reference](./QUICK_REFERENCE.md) - API quick reference

## API Reference

### VectorSearchManager Methods

- `addDocument(text: string, id?: string): Promise<string>` - Add new document
- `updateDocument(id: string, newText: string): Promise<void>` - Update existing document
- `deleteDocument(id: string): Promise<void>` - Delete document (soft)
- `compactIndex(): Promise<void>` - Remove soft-deleted nodes (hard delete)
- `getDocument(id: string): Promise<IDocument | undefined>` - Retrieve document
- `hasDocument(id: string): Promise<boolean>` - Check if document exists
- `search(query: string, k?: number): Promise<ISearchResult[]>` - Search by similarity
- `getStats(): Promise<IndexStats>` - Get index statistics
- `size(): Promise<number>` - Get total node count

### ContentStore Methods

- `addDocument(id: string, text: string): Promise<string>` - Add document
- `updateDocument(id: string, text: string): Promise<string>` - Update document
- `deleteDocument(id: string): Promise<void>` - Delete document
- `getDocument(id: string): Promise<IDocument | undefined>` - Get single document
- `getDocuments(keys: string[]): Promise<(IDocument | undefined)[]>` - Get multiple documents
- `getAllDocuments(): Promise<IDocument[]>` - Get all documents
- `count(): Promise<number>` - Count documents
- `clear(): Promise<void>` - Clear all documents
