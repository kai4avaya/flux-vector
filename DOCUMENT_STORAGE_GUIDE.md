# Document Storage & Processing Guide

This guide explains how documents are processed, stored, and retrieved in the flux-vector library.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      Your Application                            │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                   VectorSearchManager                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Embedding   │  │ ContentStore │  │    Mememo    │          │
│  │   Engine     │  │  (IndexedDB) │  │ (HNSW Index) │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                  │                   │
│         │ Text → Vector   │ ID → Text        │ Vector → ID      │
│         └─────────────────┴──────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
```

## How Document Storage Works

### Step 1: Adding a Document

When you call `searchManager.addDocument(text, id)`:

```typescript
const searchManager = new VectorSearchManager();

// Add a document - returns the document ID
const docId = await searchManager.addDocument(
  "Machine learning is a subset of artificial intelligence.",
  "ml-definition"  // Optional: provide your own ID
);
```

**Internally, three things happen:**

1. **Generate Embedding**: Text is converted to a vector (e.g., 384 dimensions)
   ```typescript
   const vector = await embeddingEngine.embed(text);
   // Result: [0.123, -0.456, 0.789, ...] (384 numbers)
   ```

2. **Store in ContentStore**: Original text is saved in IndexedDB
   ```typescript
   await contentStore.addDocument(id, text);
   // Stored: { id: "ml-definition", text: "Machine learning is..." }
   ```

3. **Index in HNSW**: Vector is added to the HNSW graph for fast search
   ```typescript
   await index.add(id, vector);
   // Creates connections in the graph for similarity search
   ```

### Step 2: Searching Documents

When you search:

```typescript
const results = await searchManager.search("What is AI?", 3);
```

**What happens:**

1. **Query Embedding**: Your query is converted to a vector
2. **HNSW Search**: Finds the top K most similar vectors (fast!)
3. **Text Retrieval**: Fetches original text from ContentStore for each result
4. **Return Results**: You get the full text, not just IDs

```typescript
// Example result
[
  {
    key: "ml-definition",
    text: "Machine learning is a subset of artificial intelligence.",
    distance: 0.12  // Lower = more similar
  },
  {
    key: "ai-intro",
    text: "Artificial intelligence enables computers to think.",
    distance: 0.18
  }
]
```

## ContentStore: Your Document Database

The ContentStore is a Dexie wrapper around IndexedDB that stores your documents.

### Basic Operations

```typescript
const contentStore = searchManager.contentStore;

// 1. Get a single document
const doc = await contentStore.documents.get("doc-id");
console.log(doc.id);    // "doc-id"
console.log(doc.text);  // "The actual content..."

// 2. Get multiple documents
const docs = await contentStore.getDocuments(["id1", "id2", "id3"]);
docs.forEach(doc => {
  if (doc) {
    console.log(`${doc.id}: ${doc.text}`);
  }
});

// 3. Query all documents
const allDocs = await contentStore.documents.toArray();
console.log(`Total documents: ${allDocs.length}`);

// 4. Delete a document
await contentStore.documents.delete("doc-id");

// 5. Clear all documents
await contentStore.documents.clear();
```

### Advanced Queries with Dexie

Since ContentStore extends Dexie, you can use all Dexie query features:

```typescript
// Filter documents
const filtered = await contentStore.documents
  .filter(doc => doc.text.includes("machine learning"))
  .toArray();

// Limit results
const first10 = await contentStore.documents
  .limit(10)
  .toArray();

// Count documents
const count = await contentStore.documents.count();

// Iterate with cursor
await contentStore.documents.each(doc => {
  console.log(doc.id);
});
```

## Document Processing Pipeline

For PDFs, images, and other file formats:

### Complete Example

```typescript
import { DocumentProcessor } from './document-processing';
import VectorSearchManager from './embeddings/VectorSearchManager';

// 1. Initialize
const processor = new DocumentProcessor({
  chunkingConfig: {
    chunkSize: 1000,
    chunkOverlap: 200,
  }
});
const searchManager = new VectorSearchManager();

// 2. Process a PDF file
const chunks = await processor.processDocument(
  pdfFile,
  'application/pdf',
  { filename: 'research.pdf' }
);

// 3. Index all chunks
for (const chunk of chunks) {
  // Create a unique ID for each chunk
  const chunkId = `research.pdf_chunk_${chunk.index}`;
  
  // Add to search manager (stores in ContentStore + indexes in HNSW)
  await searchManager.addDocument(chunk.text, chunkId);
}

// 4. Search across all chunks
const results = await searchManager.search("neural networks", 5);

// 5. Access results
results.forEach(result => {
  console.log(`Score: ${(1 - result.distance).toFixed(3)}`);
  console.log(`Chunk: ${result.key}`);
  console.log(`Text: ${result.text}\n`);
});
```

### What's in a Chunk?

Each chunk from DocumentProcessor contains:

```typescript
interface ProcessedChunk {
  text: string;              // The chunk content
  index: number;             // 0, 1, 2, ... (position in document)
  metadata: {
    filename: string;        // "research.pdf"
    mimeType: string;        // "application/pdf"
    extractedAt: Date;       // When it was processed
    chunkingStrategy: string;// "default", "sentence", etc.
    totalChunks: number;     // How many chunks total
  }
}
```

## Storage Persistence

### Browser Storage

All data persists in the browser's IndexedDB:

```typescript
// Data is automatically saved and loaded
const searchManager = new VectorSearchManager({
  indexConfig: {
    useIndexedDB: true  // Default
  }
});

// When you reload the page, data is still there!
const results = await searchManager.search("previous query");
```

### Data Size Considerations

IndexedDB typically has these limits:
- Chrome: ~60% of available disk space
- Firefox: Up to 2GB per origin
- Safari: Up to 1GB per origin

For large document collections, consider:
1. Chunking documents into smaller pieces
2. Periodically cleaning up old documents
3. Using larger chunk sizes to reduce total chunks
4. Implementing pagination for large result sets

## Common Patterns

### Pattern 1: Process Multiple Documents

```typescript
const files = [
  { file: pdf1, mimeType: 'application/pdf', name: 'doc1.pdf' },
  { file: pdf2, mimeType: 'application/pdf', name: 'doc2.pdf' },
  { file: image1, mimeType: 'image/png', name: 'diagram.png' },
];

for (const { file, mimeType, name } of files) {
  const chunks = await processor.processDocument(file, mimeType, { filename: name });
  
  for (const chunk of chunks) {
    await searchManager.addDocument(
      chunk.text,
      `${name}_chunk_${chunk.index}`
    );
  }
}
```

### Pattern 2: Update a Document

```typescript
// To update a document, just add it again with the same ID
await searchManager.addDocument(
  "Updated content here",
  "existing-doc-id"  // Same ID = update
);
```

### Pattern 3: Delete a Document

```typescript
// Delete from ContentStore
await searchManager.contentStore.documents.delete("doc-id");

// Note: Also delete from HNSW index if you want to remove it from search
// (Currently no built-in method - this is a known limitation)
```

### Pattern 4: Export All Documents

```typescript
// Get all documents from ContentStore
const allDocs = await searchManager.contentStore.documents.toArray();

// Export as JSON
const backup = JSON.stringify(allDocs, null, 2);
await downloadFile('backup.json', backup);

// Import back
const restored = JSON.parse(backupData);
for (const doc of restored) {
  await searchManager.addDocument(doc.text, doc.id);
}
```

### Pattern 5: Search with Metadata Filtering

```typescript
// First search
const results = await searchManager.search("machine learning", 20);

// Then filter by document source
const pdfResults = results.filter(r => r.key.endsWith('.pdf'));
const imageResults = results.filter(r => r.key.includes('_image_'));
```

## Best Practices

### 1. Use Meaningful IDs

```typescript
// Good: Descriptive, unique IDs
await searchManager.addDocument(text, "whitepaper_2024_section1");
await searchManager.addDocument(text, "faq_question_42");

// Avoid: Generic or random IDs (unless auto-generated)
await searchManager.addDocument(text, "doc1");
```

### 2. Chunk Size Matters

```typescript
// Too small = too many chunks, higher storage, slower
chunkSize: 200

// Too large = less precise search results
chunkSize: 5000

// Recommended: 500-1500 characters
chunkSize: 1000
```

### 3. Leverage Metadata

```typescript
// Store metadata in the chunk ID or separate system
const metadata = {
  source: "research.pdf",
  page: 5,
  section: "Introduction",
  date: "2024-01-15"
};

// Encode in ID
const chunkId = `research.pdf_p5_intro_chunk_0`;

// Or use a separate metadata store
metadataStore.set(chunkId, metadata);
```

### 4. Handle Errors Gracefully

```typescript
try {
  const chunks = await processor.processDocument(file, mimeType);
  
  for (const chunk of chunks) {
    try {
      await searchManager.addDocument(chunk.text, chunkId);
    } catch (error) {
      console.error(`Failed to index chunk ${chunkId}:`, error);
      // Continue with other chunks
    }
  }
} catch (error) {
  console.error("Document processing failed:", error);
}
```

### 5. Monitor Storage Usage

```typescript
// Check how many documents you have
const totalDocs = await searchManager.size();
console.log(`Indexed documents: ${totalDocs}`);

// Check ContentStore size
const allDocs = await searchManager.contentStore.documents.toArray();
const totalSize = allDocs.reduce((sum, doc) => sum + doc.text.length, 0);
console.log(`Total text size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
```

## Troubleshooting

### Issue: Search returns no results

```typescript
// Check if documents were added
const count = await searchManager.size();
console.log(`Documents in index: ${count}`);

// Check if text is in ContentStore
const allDocs = await searchManager.contentStore.documents.toArray();
console.log(`Documents in store: ${allDocs.length}`);
```

### Issue: Out of memory

```typescript
// Process documents in batches
const batchSize = 10;
for (let i = 0; i < files.length; i += batchSize) {
  const batch = files.slice(i, i + batchSize);
  await processBatch(batch);
  
  // Give browser time to garbage collect
  await new Promise(resolve => setTimeout(resolve, 100));
}
```

### Issue: IndexedDB quota exceeded

```typescript
// Estimate storage before adding
if (navigator.storage && navigator.storage.estimate) {
  const estimate = await navigator.storage.estimate();
  const percentUsed = (estimate.usage / estimate.quota) * 100;
  
  if (percentUsed > 80) {
    console.warn("Storage almost full:", percentUsed.toFixed(1) + "%");
    // Prompt user to clear old data
  }
}
```

## API Reference

### VectorSearchManager

```typescript
class VectorSearchManager {
  // Add a document
  async addDocument(text: string, id?: string): Promise<string>
  
  // Search for similar documents
  async search(query: string, k?: number): Promise<ISearchResult[]>
  
  // Get total number of indexed documents
  async size(): Promise<number>
  
  // Access the content store
  contentStore: ContentStore
}
```

### ContentStore

```typescript
class ContentStore extends Dexie {
  // Table of documents
  documents: Table<IDocument, string>
  
  // Add a document
  async addDocument(id: string, text: string): Promise<string>
  
  // Get multiple documents
  async getDocuments(keys: string[]): Promise<(IDocument | undefined)[]>
}
```

### IDocument

```typescript
interface IDocument {
  id: string;    // Document ID
  text: string;  // Original text content
}
```

### ISearchResult

```typescript
interface ISearchResult {
  key: string;       // Document ID
  text: string;      // Original document text
  distance: number;  // Similarity score (lower = more similar)
}
```

## Conclusion

The flux-vector library provides a seamless integration between document processing, text storage, and vector search. By understanding how ContentStore works alongside the HNSW index, you can build powerful semantic search applications that persist data locally in the browser.

Key takeaways:
- ✅ Documents are automatically stored in ContentStore (IndexedDB)
- ✅ Original text is always retrievable via document ID
- ✅ Search returns full text, not just IDs
- ✅ Data persists across browser sessions
- ✅ No external database or server required
- ✅ Works with PDFs, images, text files, and more
