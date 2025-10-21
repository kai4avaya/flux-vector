# Flux-Vector Persistence Guide

## Overview
This guide explains how to enable persistence in the flux-vector HNSW index, allowing your vector search index to survive application restarts without rebuilding.

## What Was Added

### 1. **clearOnInit Configuration Option**
A new `clearOnInit` option was added to `HNSWConfig`:

```typescript
interface HNSWConfig {
  // ... existing options ...
  
  /** Whether to clear IndexedDB on initialization. If false, enables persistence
   * across sessions. Default to true (clear on init).
   */
  clearOnInit?: boolean;
}
```

**Default Behavior (clearOnInit=true)**: IndexedDB is cleared on each new instance, ensuring a fresh start.

**Persistence Mode (clearOnInit=false)**: IndexedDB data is preserved, and the graph structure is automatically loaded if available.

### 2. **Index Metadata Table**
A new `indexMetadata` table was added to the IndexedDB schema to store the graph structure JSON:

```typescript
myDexie.version(1).stores({
  mememo: 'key',           // Stores node embeddings
  indexMetadata: 'id'       // Stores graph structure (NEW)
});
```

### 3. **New Methods**

#### `saveIndex(): Promise<void>`
Saves the current index structure to IndexedDB for persistence.

```typescript
const index = new HNSW({
  distanceFunction: 'cosine-normalized',
  useIndexedDB: true,
  clearOnInit: false
});

// Add documents
await index.insert('doc1', embedding1);
await index.insert('doc2', embedding2);

// Save for later
await index.saveIndex();
```

**What it saves:**
- Graph structure (layers, neighbors, connections)
- Metadata (m, efConstruction, distance function, etc.)

**What it doesn't save:**
- Embeddings are automatically persisted in IndexedDB (in the `mememo` table)

#### `loadPersistedIndex(): Promise<MememoIndexJSON | null>`
Loads a previously saved index from IndexedDB.

```typescript
const persistedData = await index.loadPersistedIndex();
if (persistedData) {
  console.log('Found persisted index!');
} else {
  console.log('No persisted data found');
}
```

Returns `null` if:
- No persisted data exists
- IndexedDB is disabled (`useIndexedDB: false`)
- An error occurs during loading

### 4. **Automatic Loading**
When `clearOnInit: false`, the index automatically attempts to load persisted data on construction:

```typescript
// This automatically loads any persisted index
const index = new HNSW({
  distanceFunction: 'cosine-normalized',
  useIndexedDB: true,
  clearOnInit: false  // Enable persistence
});

// Wait for async initialization
await new Promise(resolve => setTimeout(resolve, 100));

// Now you can query immediately if data was persisted
const results = await index.query(queryEmbedding, 10);
```

## Usage Examples

### Basic Persistence Workflow

```typescript
import { HNSW } from 'flux-vector/mememo';

// Session 1: Create and save
const index1 = new HNSW({
  distanceFunction: 'cosine-normalized',
  m: 16,
  efConstruction: 100,
  useIndexedDB: true,
  clearOnInit: false  // KEY: Enable persistence
});

// Build your index
for (const doc of documents) {
  await index1.insert(doc.id, doc.embedding);
}

// Save before closing
await index1.saveIndex();

// --- App restarts ---

// Session 2: Load automatically
const index2 = new HNSW({
  distanceFunction: 'cosine-normalized',
  m: 16,
  efConstruction: 100,
  useIndexedDB: true,
  clearOnInit: false
});

// Wait for async initialization to complete
await new Promise(resolve => setTimeout(resolve, 100));

// Query immediately - data is already loaded!
const results = await index2.query(queryEmbedding, 5);
console.log('Results:', results.keys);
```

### Incremental Updates

```typescript
// Load existing index
const index = new HNSW({
  distanceFunction: 'cosine-normalized',
  useIndexedDB: true,
  clearOnInit: false
});

await new Promise(resolve => setTimeout(resolve, 100));

// Add new documents
await index.insert('new-doc-1', embedding1);
await index.insert('new-doc-2', embedding2);

// Save updated index
await index.saveIndex();
```

### Conditional Persistence

```typescript
const enablePersistence = localStorage.getItem('enable-persistence') === 'true';

const index = new HNSW({
  distanceFunction: 'cosine-normalized',
  useIndexedDB: true,
  clearOnInit: !enablePersistence
});

if (enablePersistence) {
  await new Promise(resolve => setTimeout(resolve, 100));
  const size = await index.nodes.size();
  console.log(`Loaded ${size} documents from persistence`);
}
```

### React Integration Example

```typescript
import { useState, useEffect } from 'react';
import { HNSW } from 'flux-vector/mememo';

function usePersistedIndex() {
  const [index, setIndex] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initIndex = async () => {
      const newIndex = new HNSW({
        distanceFunction: 'cosine-normalized',
        useIndexedDB: true,
        clearOnInit: false
      });

      // Wait for persistence to load
      await new Promise(resolve => setTimeout(resolve, 100));

      setIndex(newIndex);
      setLoading(false);
    };

    initIndex();

    // Save on unmount
    return () => {
      if (index) {
        index.saveIndex().catch(console.error);
      }
    };
  }, []);

  return { index, loading };
}

// Usage in component
function SearchComponent() {
  const { index, loading } = usePersistedIndex();

  const handleSearch = async (query) => {
    if (!index) return;
    const results = await index.query(queryEmbedding, 10);
    // Display results...
  };

  const handleAddDocument = async (id, embedding) => {
    if (!index) return;
    await index.insert(id, embedding);
    await index.saveIndex(); // Save after updates
  };

  if (loading) return <div>Loading index...</div>;
  return <div>/* Your search UI */</div>;
}
```

## Storage Considerations

### What's Stored Where

| Data | Location | Size | Persists? |
|------|----------|------|-----------|
| Embeddings | IndexedDB `mememo` table | Large (e.g., 10k × 384 floats ≈ 15MB) | ✅ Always (when useIndexedDB=true) |
| Graph Structure | IndexedDB `indexMetadata` table | Small (1k-50MB depending on size) | ✅ When clearOnInit=false |
| In-Memory State | RAM | Same as graph | ❌ Lost on restart |

### IndexedDB vs localStorage

We use **IndexedDB** for the graph structure because:
- ✅ Larger storage limits (~50MB+ per origin)
- ✅ Asynchronous (non-blocking)
- ✅ Already used for embeddings
- ✅ Better for large datasets

**localStorage limitations:**
- ❌ Only ~5-10MB total
- ❌ Synchronous (blocks UI)
- ❌ String-only (requires JSON.stringify/parse)

### Storage Size Estimates

| Index Size | Graph JSON | Total Storage |
|------------|------------|---------------|
| 1k nodes (m=16) | ~100-500KB | ~2-5MB |
| 10k nodes (m=16) | ~1-5MB | ~15-20MB |
| 100k nodes (m=16) | ~10-50MB | ~150-200MB |

## Best Practices

### 1. Always Save After Bulk Operations
```typescript
// Bad: No save
for (const doc of manyDocs) {
  await index.insert(doc.id, doc.embedding);
}
// Data lost if app crashes!

// Good: Save after bulk insert
for (const doc of manyDocs) {
  await index.insert(doc.id, doc.embedding);
}
await index.saveIndex();
```

### 2. Handle Async Initialization
```typescript
const index = new HNSW({ /* ... */, clearOnInit: false });

// BAD: Query immediately
const results = await index.query(embedding, 5); // May not have loaded yet!

// GOOD: Wait for initialization
await new Promise(resolve => setTimeout(resolve, 100));
const results = await index.query(embedding, 5);
```

### 3. Check for Persisted Data
```typescript
const index = new HNSW({ /* ... */, clearOnInit: false });
await new Promise(resolve => setTimeout(resolve, 100));

const size = await index.nodes.size();
if (size === 0) {
  console.log('No persisted data, building fresh index...');
  // Build index from scratch
} else {
  console.log(`Loaded ${size} documents from persistence`);
}
```

### 4. Error Handling
```typescript
try {
  await index.saveIndex();
} catch (error) {
  console.error('Failed to save index:', error);
  // Maybe retry or notify user
}
```

## Migrating from Non-Persistent to Persistent

If you have an existing index without persistence:

```typescript
// Old code (no persistence)
const oldIndex = new HNSW({
  distanceFunction: 'cosine-normalized',
  useIndexedDB: true
  // clearOnInit defaults to true
});

// Add data...

// NEW: Enable persistence and save
const newIndex = new HNSW({
  distanceFunction: 'cosine-normalized',
  useIndexedDB: true,
  clearOnInit: false  // Enable persistence
});

// Rebuild index (one-time migration)
for (const doc of documents) {
  await newIndex.insert(doc.id, doc.embedding);
}

// Save for future sessions
await newIndex.saveIndex();
```

## Testing

See `mememo/test/mememo.persistence.test.ts` for comprehensive test examples:
- Save/load cycles
- Multiple sessions
- Empty index handling
- Search accuracy after persistence
- Error cases

Run tests:
```bash
cd flux-vector/mememo
npm test test/mememo.persistence.test.ts
```

## Troubleshooting

### Data Not Persisting
**Problem**: Index is empty after restart

**Solutions**:
1. Verify `clearOnInit: false` is set
2. Check that `saveIndex()` was called before closing
3. Ensure `useIndexedDB: true` (can't persist in-memory)
4. Wait for async initialization: `await new Promise(resolve => setTimeout(resolve, 100));`

### IndexedDB Quota Errors
**Problem**: "QuotaExceededError" when saving

**Solutions**:
1. Check available storage: `navigator.storage.estimate()`
2. Clear old data: `await index.nodes.clear()`
3. Reduce index size (fewer documents or lower m parameter)

### Stale Data Issues
**Problem**: Old data appears after updates

**Solutions**:
1. Always call `saveIndex()` after modifications
2. To force refresh: set `clearOnInit: true` once, then back to `false`
3. Manual clear: Delete IndexedDB via browser dev tools

### Performance Degradation
**Problem**: Slow queries after persistence

**Solutions**:
1. Verify embeddings are loaded: `await index.nodes.size()`
2. Check for prefetch issues (enable logging)
3. Consider rebuilding index if very old

## API Reference

### HNSWConfig
```typescript
interface HNSWConfig {
  distanceFunction?: 'cosine' | 'cosine-normalized' | ((a: number[], b: number[]) => number);
  m?: number;
  efConstruction?: number;
  useIndexedDB?: boolean;
  clearOnInit?: boolean;  // NEW: Enable persistence
}
```

### HNSW Methods

#### `saveIndex(): Promise<void>`
Saves the graph structure to IndexedDB.

**Throws**: Error if `useIndexedDB: false`

#### `loadPersistedIndex(): Promise<MememoIndexJSON | null>`
Loads the graph structure from IndexedDB.

**Returns**: Index data or `null` if none exists

#### `nodes.size(): Promise<number>`
Get the number of indexed documents.

#### `query(embedding: number[], k?: number, ef?: number): Promise<{ keys: string[], distances: number[] }>`
Search for k nearest neighbors.

**Returns**: Object with `keys` (document IDs) and `distances` arrays.

## Next Steps

1. ✅ Build succeeds with no errors
2. ✅ Persistence tests created
3. 📋 **TODO**: Integrate into `event_store_react_project`
4. 📋 **TODO**: Add to VectorSearchManager wrapper
5. 📋 **TODO**: Update flux-vector README with persistence examples

See `INTEGRATION_GUIDE.md` for instructions on using flux-vector in your React project.
