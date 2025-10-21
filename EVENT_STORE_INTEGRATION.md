# Integrating Flux-Vector into Event Store React Project

## Overview
This guide shows you how to add the `flux-vector` package to your `event_store_react_project` and use it for semantic search over your documents, notes, and project data.

## Step 1: Add Flux-Vector as a Local Dependency

Since `flux-vector` is in the same workspace, add it as a local file dependency:

```bash
cd c:\Users\somat\Documents\dev\aiResearch\event_store_react_project
npm install ../flux-vector
```

Or manually add to `package.json`:

```json
{
  "dependencies": {
    "flux-vector": "file:../flux-vector",
    "event-store-oop": "file:../event-store-oop",
    // ... other dependencies
  }
}
```

Then run:
```bash
npm install
```

## Step 2: Build Flux-Vector

Make sure flux-vector is built before using it:

```bash
cd ../flux-vector
npm run build
```

This creates the `dist/` folder with compiled JavaScript and TypeScript definitions.

## Step 3: Import and Use in Your React App

### Basic Usage Example

Create a new file: `src/hooks/useVectorSearch.js`

```javascript
import { useState, useEffect } from 'react';
import VectorSearchManager from 'flux-vector/embeddings/VectorSearchManager';

/**
 * Hook to manage a vector search index with persistence
 */
export function useVectorSearch() {
  const [searchManager, setSearchManager] = useState(null);
  const [loading, setLoading] = useState(true);
  const [indexSize, setIndexSize] = useState(0);

  useEffect(() => {
    const initSearch = async () => {
      // Create search manager with persistence enabled
      const manager = new VectorSearchManager({
        indexConfig: {
          distanceFunction: 'cosine-normalized',
          m: 16,
          efConstruction: 200,
          useIndexedDB: true,
          clearOnInit: false  // Enable persistence!
        }
      });

      // Wait for persistence to load
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check how many documents are indexed
      const size = await manager.size();
      setIndexSize(size);
      
      setSearchManager(manager);
      setLoading(false);
    };

    initSearch();

    // Save on unmount
    return () => {
      if (searchManager) {
        searchManager.index.saveIndex().catch(console.error);
      }
    };
  }, []);

  const addDocument = async (text, id) => {
    if (!searchManager) return;
    const docId = await searchManager.addDocument(text, id);
    
    // Save after adding
    await searchManager.index.saveIndex();
    
    // Update size
    const newSize = await searchManager.size();
    setIndexSize(newSize);
    
    return docId;
  };

  const search = async (query, k = 5) => {
    if (!searchManager) return [];
    return await searchManager.search(query, k);
  };

  return {
    searchManager,
    loading,
    indexSize,
    addDocument,
    search
  };
}
```

### Using in a Component

```javascript
import React, { useState } from 'react';
import { useVectorSearch } from '../hooks/useVectorSearch';

function SemanticSearch() {
  const { searchManager, loading, indexSize, search } = useVectorSearch();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);

  const handleSearch = async () => {
    if (!query.trim()) return;
    
    const searchResults = await search(query, 10);
    setResults(searchResults);
  };

  if (loading) {
    return <div>Loading semantic search index...</div>;
  }

  return (
    <div className="semantic-search">
      <div className="search-info">
        <p>{indexSize} documents indexed</p>
      </div>
      
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search your documents semantically..."
        onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
      />
      
      <button onClick={handleSearch}>Search</button>

      <div className="results">
        {results.map((result, i) => (
          <div key={result.key} className="result">
            <h4>Result {i + 1}</h4>
            <p>Similarity: {(1 - result.distance).toFixed(3)}</p>
            <p>{result.text.substring(0, 200)}...</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default SemanticSearch;
```

## Step 4: Index Your Event Store Documents

Create a service to index documents from your event store:

`src/services/documentIndexer.js`

```javascript
import VectorSearchManager from 'flux-vector/embeddings/VectorSearchManager';

export class DocumentIndexer {
  constructor(eventStore) {
    this.eventStore = eventStore;
    this.searchManager = null;
  }

  async initialize() {
    this.searchManager = new VectorSearchManager({
      indexConfig: {
        distanceFunction: 'cosine-normalized',
        m: 16,
        efConstruction: 200,
        useIndexedDB: true,
        clearOnInit: false
      }
    });

    // Wait for persistence
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  /**
   * Index all documents from the event store
   */
  async indexAllDocuments(projectId) {
    const documents = await this.eventStore.getDocuments(projectId);
    
    for (const doc of documents) {
      // Combine title and content for better search
      const searchableText = `${doc.title || ''}\n${doc.content || ''}`;
      
      if (searchableText.trim()) {
        await this.searchManager.addDocument(
          searchableText,
          `${projectId}-${doc.id}`
        );
      }
    }

    // Save after bulk indexing
    await this.searchManager.index.saveIndex();
    
    return await this.searchManager.size();
  }

  /**
   * Index a single document (called when document is created/updated)
   */
  async indexDocument(projectId, documentId, content) {
    const docKey = `${projectId}-${documentId}`;
    
    // Check if already indexed
    const existingDoc = await this.searchManager.contentStore.documents.get(docKey);
    
    if (existingDoc) {
      // Update: delete and re-add
      await this.searchManager.contentStore.documents.delete(docKey);
      // Note: HNSW doesn't support updates directly, would need to rebuild
      // For now, just update the content store
      await this.searchManager.contentStore.addDocument(docKey, content);
    } else {
      // Add new
      await this.searchManager.addDocument(content, docKey);
    }

    await this.searchManager.index.saveIndex();
  }

  /**
   * Search across indexed documents
   */
  async search(query, k = 10) {
    return await this.searchManager.search(query, k);
  }

  /**
   * Get index statistics
   */
  async getStats() {
    const size = await this.searchManager.size();
    return {
      totalDocuments: size,
      storageUsed: await this._getStorageSize()
    };
  }

  async _getStorageSize() {
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      return {
        used: estimate.usage,
        quota: estimate.quota,
        percentage: ((estimate.usage / estimate.quota) * 100).toFixed(2)
      };
    }
    return null;
  }
}
```

### Integrate with EventStoreContext

Update `src/context/EventStoreContext.jsx`:

```javascript
import { DocumentIndexer } from '../services/documentIndexer';

// Add to context state
const [documentIndexer, setDocumentIndexer] = useState(null);
const [searchReady, setSearchReady] = useState(false);

// Initialize in useEffect
useEffect(() => {
  const initIndexer = async () => {
    const indexer = new DocumentIndexer(eventStore);
    await indexer.initialize();
    setDocumentIndexer(indexer);
    setSearchReady(true);
  };

  if (eventStore) {
    initIndexer();
  }
}, [eventStore]);

// Add to context value
return (
  <EventStoreContext.Provider value={{
    // ... existing values
    documentIndexer,
    searchReady
  }}>
    {children}
  </EventStoreContext.Provider>
);
```

## Step 5: Create a Search Component

`src/components/SemanticSearchPanel.jsx`

```javascript
import React, { useState, useContext } from 'react';
import { EventStoreContext } from '../context/EventStoreContext';

function SemanticSearchPanel() {
  const { documentIndexer, searchReady } = useContext(EventStoreContext);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const handleSearch = async () => {
    if (!query.trim() || !documentIndexer) return;
    
    setSearching(true);
    try {
      const searchResults = await documentIndexer.search(query, 10);
      setResults(searchResults);
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setSearching(false);
    }
  };

  const handleReindex = async () => {
    if (!documentIndexer) return;
    
    const currentProjectId = getCurrentProjectId(); // Get from your context
    const count = await documentIndexer.indexAllDocuments(currentProjectId);
    alert(`Indexed ${count} documents`);
  };

  if (!searchReady) {
    return <div>Initializing semantic search...</div>;
  }

  return (
    <div className="semantic-search-panel">
      <h2>Semantic Search</h2>
      
      <div className="search-controls">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search across all your documents..."
          onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
        />
        <button onClick={handleSearch} disabled={searching}>
          {searching ? 'Searching...' : 'Search'}
        </button>
        <button onClick={handleReindex}>Reindex All</button>
      </div>

      {results.length > 0 && (
        <div className="search-results">
          <h3>{results.length} results found</h3>
          {results.map((result, i) => (
            <div key={result.key} className="search-result">
              <div className="result-header">
                <span className="result-rank">#{i + 1}</span>
                <span className="result-similarity">
                  {((1 - result.distance) * 100).toFixed(1)}% match
                </span>
              </div>
              <p className="result-text">{result.text.substring(0, 300)}...</p>
              <button onClick={() => openDocument(result.key)}>
                Open Document
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default SemanticSearchPanel;
```

## Step 6: Auto-Index on Document Creation

Hook into your document creation flow:

```javascript
// In your document editor or save handler
const handleSaveDocument = async (projectId, documentId, content) => {
  // Save to event store (your existing code)
  await eventStore.saveDocument(projectId, documentId, content);
  
  // Index for semantic search
  if (documentIndexer) {
    await documentIndexer.indexDocument(projectId, documentId, content);
  }
};
```

## Advanced: Processing PDFs and Images

If you want to index uploaded files:

```javascript
import { DocumentProcessor } from 'flux-vector/document-processing';

const processor = new DocumentProcessor({
  chunkingConfig: {
    chunkSize: 1000,
    chunkOverlap: 200
  }
});

async function indexUploadedFile(file, projectId) {
  // Extract text from file
  const chunks = await processor.processDocument(
    file,
    file.type,
    { filename: file.name }
  );

  // Index each chunk
  for (const chunk of chunks) {
    const chunkId = `${projectId}-${file.name}-chunk-${chunk.index}`;
    await documentIndexer.searchManager.addDocument(chunk.text, chunkId);
  }

  await documentIndexer.searchManager.index.saveIndex();
}
```

## Configuration Options

### For Better Performance

```javascript
new VectorSearchManager({
  indexConfig: {
    distanceFunction: 'cosine-normalized', // Faster than 'cosine'
    m: 32,  // More connections = better recall, slower build
    efConstruction: 400,  // Higher = better index quality
    useIndexedDB: true,
    clearOnInit: false
  }
});
```

### For Memory-Constrained Environments

```javascript
new VectorSearchManager({
  indexConfig: {
    distanceFunction: 'cosine-normalized',
    m: 8,  // Fewer connections = less memory
    efConstruction: 100,
    useIndexedDB: true,  // MUST be true for large datasets
    clearOnInit: false
  }
});
```

## Testing the Integration

1. **Build flux-vector**:
   ```bash
   cd flux-vector
   npm run build
   ```

2. **Install in your project**:
   ```bash
   cd ../event_store_react_project
   npm install ../flux-vector
   ```

3. **Start your dev server**:
   ```bash
   npm run dev
   ```

4. **Test basic search**:
   - Open browser console
   - Try: 
   ```javascript
   import VectorSearchManager from 'flux-vector/embeddings/VectorSearchManager';
   const manager = new VectorSearchManager();
   await manager.addDocument("Test document");
   const results = await manager.search("test", 1);
   console.log(results);
   ```

## Troubleshooting

### Module Not Found
**Error**: `Cannot find module 'flux-vector'`

**Solution**: Ensure flux-vector is built (`npm run build`) and installed as dependency

### IndexedDB Errors
**Error**: `QuotaExceededError`

**Solution**: Clear browser storage or reduce index size

### Slow Performance
**Problem**: Search takes too long

**Solutions**:
- Reduce `efConstruction` (faster build, slightly worse quality)
- Use `distanceFunction: 'cosine-normalized'` (faster)
- Consider chunking very large documents

### Memory Issues
**Problem**: Browser crashes with large datasets

**Solutions**:
- Ensure `useIndexedDB: true`
- Chunk large documents before indexing
- Reduce `m` parameter

## Next Steps

1. ✅ Add flux-vector as dependency
2. ✅ Create useVectorSearch hook
3. ✅ Build semantic search UI
4. 📋 Index existing documents
5. 📋 Add auto-indexing on document save
6. 📋 Add PDF/image processing if needed
7. 📋 Optimize for your use case

## Resources

- [Flux-Vector README](../flux-vector/README.md)
- [Persistence Guide](../flux-vector/PERSISTENCE_GUIDE.md)
- [Mememo HNSW Tests](../flux-vector/mememo/test/)
- [Integration Examples](../flux-vector/integration-examples.ts)
