# Flux-Vector: Semantic Search with HNSW and Embeddings

A lightweight, browser-based semantic search library that combines the Mememo HNSW (Hierarchical Navigable Small World) index with transformer-based embeddings for fast, accurate vector similarity search.

## Features

- **🚀 Fast Vector Search**: Optimized HNSW algorithm with LRU caching and cross-layer prefetching (~75% faster queries)
- **🧠 Semantic Understanding**: Uses transformer models to create meaningful text embeddings
- **💾 Persistent Storage**: IndexedDB integration with incremental saves (~90% faster for updates)
- **🔧 Flexible Configuration**: Bring your own embedding model or use the default
- **📦 Modular Architecture**: Clean separation between indexing, embeddings, and storage
- **⚡ Production-Ready**: Battle-tested optimizations eliminate race conditions and memory bloat

## Architecture

The library consists of four main components working together:

```
┌─────────────────────────────────────────────────────────────────┐
│                    VectorSearchManager                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Embedding   │  │ ContentStore │  │    Mememo    │          │
│  │   Engine     │  │  (IndexedDB) │  │  (HNSW Index)│          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│        ▲                  ▲                  ▲                   │
│        │                  │                  │                   │
│        └──────────────────┴──────────────────┘                   │
│                    Orchestrates all                              │
└─────────────────────────────────────────────────────────────────┘
                           ▲
                           │ Uses
                           │
┌──────────────────────────┴──────────────────────────────────────┐
│              DocumentProcessor (Optional)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Document    │  │     Text     │  │   Chunking   │          │
│  │  Extractor   │→│   Content    │→│   Strategies │          │
│  │ (PDF/Image)  │  │              │  │ (Recursive)  │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

### 1. **Mememo** (`/mememo`)
A TypeScript implementation of the HNSW (Hierarchical Navigable Small World) algorithm for efficient vector similarity search.
- Configurable distance functions (cosine, cosine-normalized)
- IndexedDB persistence with incremental saves
- Customizable graph parameters (m, efConstruction)
- Fast approximate nearest neighbor search with intelligent caching
- **Performance Optimizations**:
  - LRU cache system (~75% fewer IndexedDB fetches)
  - Cross-layer prefetching (4ms avg query time for 100 nodes)
  - Incremental saves with dirty tracking (~90% faster updates)
  - Race condition protection with ready() pattern

### 2. **Embeddings** (`/embeddings`)
Handles text-to-vector conversion and document storage:
- **EmbeddingPipeline**: Default HuggingFace Transformers.js implementation (Xenova/all-MiniLM-L6-v2)
- **IEmbeddingEngine**: Interface for custom embedding models (OpenAI, Cohere, local models)
- **ContentStore**: Dexie (IndexedDB) storage for original text documents
- **VectorSearchManager**: Orchestrates embeddings, storage, and search

### 3. **VectorSearchManager** (`/embeddings/VectorSearchManager.ts`)
The main interface that combines all components:
- Accepts text → generates embeddings → stores in ContentStore → indexes in Mememo
- Handles search queries end-to-end
- Returns results with original text and similarity scores
- Manages persistence across browser sessions

### 4. **Document Processing** (`/document-processing`)
Optional module for extracting and chunking text from various document formats:
- **DocumentExtractor**: PDF (pdf.js), Images (Tesseract.js OCR), Text files
- **TextChunker**: Smart text chunking strategies (recursive, sentence, paragraph)
- **DocumentProcessor**: End-to-end pipeline from files to searchable chunks

## Quick Start

### Installation

```bash
npm install
```

### Basic Usage

```typescript
import VectorSearchManager from './embeddings/VectorSearchManager';

// Initialize with default configuration
const searchManager = new VectorSearchManager();

// Add documents
await searchManager.addDocument("A small, fast boat is called a skiff.");
await searchManager.addDocument("Apples and oranges are types of fruit.");
await searchManager.addDocument("A car is a form of wheeled transport.");

// Search
const results = await searchManager.search("What is a vehicle?", 3);
console.log(results);
// Output: [{ key: "...", text: "A car is...", distance: 0.12 }, ...]
```

## Configuration

### Using Default Configuration

The library comes with sensible defaults:

```typescript
import VectorSearchManager, { DEFAULT_CONFIG } from './embeddings/VectorSearchManager';

// Uses default settings:
// - Embedding: Xenova/all-MiniLM-L6-v2 (384 dimensions)
// - Distance: cosine-normalized
// - m: 16
// - efConstruction: 200
// - IndexedDB: enabled
const searchManager = new VectorSearchManager();
```

### Custom Configuration

```typescript
import VectorSearchManager from './embeddings/VectorSearchManager';

const searchManager = new VectorSearchManager({
  indexConfig: {
    distanceFunction: 'cosine',
    m: 32,                    // More connections = better recall, slower build
    efConstruction: 400,      // Higher = better quality, slower build
    useIndexedDB: true,       // Enable persistence
  }
});
```

### Custom Embedding Engine

You can provide your own embedding model by implementing the `IEmbeddingEngine` interface:

```typescript
import { IEmbeddingEngine } from './embeddings/EmbeddingPipeline';
import VectorSearchManager from './embeddings/VectorSearchManager';

// Example: Custom OpenAI-based embedding engine
class OpenAIEmbeddingEngine implements IEmbeddingEngine {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async embed(text: string): Promise<number[]> {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-ada-002',
        input: text,
      }),
    });

    const data = await response.json();
    return data.data[0].embedding;
  }
}

// Use custom engine
const customSearchManager = new VectorSearchManager({
  embeddingEngine: new OpenAIEmbeddingEngine('your-api-key'),
  indexConfig: {
    distanceFunction: 'cosine-normalized',
  }
});
```

### Example: Local Model with ONNX

```typescript
import { IEmbeddingEngine } from './embeddings/EmbeddingPipeline';

class CustomONNXEngine implements IEmbeddingEngine {
  private session: any; // Your ONNX session

  async embed(text: string): Promise<number[]> {
    // Your custom embedding logic here
    // 1. Tokenize text
    // 2. Run through ONNX model
    // 3. Return embedding vector
    return [/* your embedding vector */];
  }
}

const searchManager = new VectorSearchManager({
  embeddingEngine: new CustomONNXEngine(),
});
```

## API Reference

### VectorSearchManager

#### `constructor(config?: VectorSearchConfig)`
Creates a new VectorSearchManager instance.

**Parameters:**
- `config.embeddingEngine` (optional): Custom embedding engine implementing IEmbeddingEngine
- `config.indexConfig.distanceFunction` (optional): 'cosine' | 'cosine-normalized' (default: 'cosine-normalized')
- `config.indexConfig.m` (optional): Number of bi-directional links per node (default: 16)
- `config.indexConfig.efConstruction` (optional): Dynamic candidate list size (default: 200)
- `config.indexConfig.useIndexedDB` (optional): Enable IndexedDB persistence (default: true)

#### `async addDocument(text: string, id?: string): Promise<string>`
Adds a document to the search index.

**Parameters:**
- `text`: The document text to index
- `id` (optional): Custom document ID. If not provided, a UUID is generated.

**Returns:** The document ID

#### `async search(queryText: string, k?: number): Promise<ISearchResult[]>`
Searches for similar documents.

**Parameters:**
- `queryText`: The search query
- `k` (optional): Number of results to return (default: 3)

**Returns:** Array of search results with `key`, `text`, and `distance` fields

#### `async size(): Promise<number>`
Returns the total number of indexed documents.

### IEmbeddingEngine Interface

```typescript
interface IEmbeddingEngine {
  embed(text: string): Promise<number[]>;
}
```

Implement this interface to create custom embedding engines.

## Default Embedding Model

The default model is **Xenova/all-MiniLM-L6-v2**:
- **Dimensions**: 384
- **Optimized for**: Semantic similarity search
- **Normalization**: Embeddings are normalized (use 'cosine-normalized' distance)
- **Source**: HuggingFace Transformers.js (runs in browser/Node.js)

## Performance Tips

1. **Adjust m parameter**: Higher values (32-48) improve recall but increase memory and build time
2. **Tune efConstruction**: Higher values (200-400) improve index quality at the cost of build time
3. **Use normalized embeddings**: If your embeddings are normalized, use 'cosine-normalized' for faster distance calculations
4. **Enable autosave**: For frequent updates, enable autosave to automatically persist changes without blocking operations
   ```typescript
   const manager = new VectorSearchManager();
   // Enable autosave with 5 second debounce
   manager.index.setAutosave(true, 5000);
   ```
5. **Use incremental saves**: For large indexes, use `incrementalSaveIndex()` instead of full saves
   ```typescript
   // Only saves changed nodes/layers (90% faster for small updates)
   await manager.index.incrementalSaveIndex();
   ```
6. **Batch operations**: When adding multiple documents, the cross-layer cache sharing automatically optimizes repeated queries

## Document Processing & Storage Pipeline

The library provides an end-to-end pipeline for processing documents and storing them in a searchable vector index.

### How Documents Are Stored

When you call `searchManager.addDocument(text, id)`, the system performs three operations:

1. **Embedding Generation**: Converts text to a vector using the embedding engine
2. **Text Storage**: Saves original text in `ContentStore` (IndexedDB database)
3. **Vector Indexing**: Adds the vector to the HNSW graph for similarity search

This design ensures that:
- ✅ Original text is preserved and retrievable
- ✅ Search returns actual content, not just IDs
- ✅ Data persists across browser sessions
- ✅ No external database required

**Under the hood:**
```typescript
// What happens when you call addDocument
async addDocument(text: string, id?: string): Promise<string> {
  // 1. Generate embedding vector
  const vector = await this.embeddingEngine.embed(text);
  
  // 2. Generate or use provided ID
  const key = id || uuidv4();
  
  // 3. Store original text in ContentStore (IndexedDB)
  await this.contentStore.addDocument(key, text);
  
  // 4. Add vector to HNSW index for similarity search
  await this.index.add(key, vector);
  
  return key;
}
```

### ContentStore: Your Document Database

The `ContentStore` is a Dexie-based IndexedDB wrapper that stores your documents:

```typescript
// Access the ContentStore directly
const contentStore = searchManager.contentStore;

// Get a single document
const doc = await contentStore.documents.get('document-id');
console.log(doc.text); // Original text

// Get multiple documents
const docs = await contentStore.getDocuments(['id1', 'id2', 'id3']);

// Query all documents
const allDocs = await contentStore.documents.toArray();

// Delete a document
await contentStore.documents.delete('document-id');

// Clear all documents
await contentStore.documents.clear();
```

### Complete Document Processing Workflow

Here's a complete example of processing a PDF and making it searchable:

```typescript
import { DocumentProcessor } from './document-processing';
import VectorSearchManager from './embeddings/VectorSearchManager';

// Step 1: Initialize components
const processor = new DocumentProcessor({
  chunkingConfig: {
    chunkSize: 1000,      // Target chunk size in characters
    chunkOverlap: 200,    // Overlap between chunks for context
  },
  extractorConfig: {
    enableOCRFallback: true,  // Enable OCR for scanned PDFs
  }
});

const searchManager = new VectorSearchManager();

// Step 2: Process a document (PDF, image, or text file)
const chunks = await processor.processDocument(
  pdfFile,                    // File, Buffer, or ArrayBuffer
  'application/pdf',
  { filename: 'research-paper.pdf' }
);

console.log(`Extracted ${chunks.length} chunks from the PDF`);

// Step 3: Index all chunks
// Each chunk is automatically:
// - Embedded into a vector
// - Stored in ContentStore (IndexedDB) with original text
// - Indexed in HNSW graph for similarity search
for (const chunk of chunks) {
  const chunkId = `${chunk.metadata.filename}_chunk_${chunk.index}`;
  await searchManager.addDocument(chunk.text, chunkId);
  
  console.log(`Indexed chunk ${chunk.index}/${chunk.metadata.totalChunks}`);
}

// Step 4: Search across all indexed chunks
const results = await searchManager.search('machine learning algorithms', 5);

// Step 5: Results include original text and similarity scores
results.forEach((result, i) => {
  console.log(`\n--- Result ${i + 1} ---`);
  console.log(`Similarity: ${(1 - result.distance).toFixed(3)}`);
  console.log(`Document: ${result.key}`);
  console.log(`Text: ${result.text.substring(0, 200)}...`);
});
```

**What's happening behind the scenes:**

1. **DocumentProcessor** extracts text from the PDF and splits it into manageable chunks
2. Each chunk contains:
   - `text`: The actual content
   - `index`: Position in the document
   - `metadata`: Filename, mime type, total chunks, etc.
3. **VectorSearchManager.addDocument()** for each chunk:
   - Generates an embedding vector from the text
   - Stores the original text in ContentStore (IndexedDB)
   - Adds the vector to the HNSW index
4. **Search queries** are embedded the same way and matched against the index
5. **Results** include the original stored text from ContentStore

### How Storage Works

When you call `searchManager.addDocument(text, id)`:

```typescript
// Internally, VectorSearchManager performs:
async addDocument(text: string, id?: string): Promise<string> {
  // 1. Generate embedding vector
  const vector = await this.embeddingEngine.embed(text);
  
  // 2. Generate or use provided ID
  const key = id || uuidv4();
  
  // 3. Store original text in ContentStore (IndexedDB)
  await this.contentStore.addDocument(key, text);
  
  // 4. Add vector to HNSW index for similarity search
  await this.index.add(key, vector);
  
  return key;
}
```

The **ContentStore** is a Dexie (IndexedDB) database that persists your original documents alongside the vector index. This means:
- ✅ Original text is preserved and retrievable
- ✅ Search returns actual content, not just IDs
- ✅ Everything persists in the browser between sessions
- ✅ No need for separate storage management

### Processing Different Document Types

```typescript
// PDF with text
const pdfChunks = await processor.processDocument(
  pdfFile,
  'application/pdf',
  { filename: 'document.pdf' }
);

// Scanned PDF (uses OCR)
const scannedChunks = await processor.processDocument(
  scannedPdfFile,
  'application/pdf',
  { filename: 'scanned.pdf' }
);

// Image (automatic OCR)
const imageChunks = await processor.processDocument(
  imageFile,
  'image/png',
  { filename: 'screenshot.png' }
);

// Plain text
const textChunks = await processor.processDocument(
  textFile,
  'text/plain',
  { filename: 'notes.txt' }
);

// Markdown
const mdChunks = await processor.processDocument(
  markdownFile,
  'text/markdown',
  { filename: 'readme.md' }
);

// Index all chunks from any format
for (const chunk of [...pdfChunks, ...imageChunks, ...textChunks]) {
  await searchManager.addDocument(chunk.text, chunk.metadata.filename + '_' + chunk.index);
}
```

### Batch Processing Multiple Documents

```typescript
const documents = [
  { file: file1, mimeType: 'application/pdf', filename: 'doc1.pdf' },
  { file: file2, mimeType: 'image/png', filename: 'diagram.png' },
  { file: file3, mimeType: 'text/plain', filename: 'notes.txt' },
];

let totalChunks = 0;

for (const doc of documents) {
  console.log(`Processing: ${doc.filename}`);
  
  const chunks = await processor.processDocument(
    doc.file,
    doc.mimeType,
    { filename: doc.filename }
  );
  
  // Add each chunk to the search index
  for (const chunk of chunks) {
    const id = `${doc.filename}_chunk_${chunk.index}`;
    await searchManager.addDocument(chunk.text, id);
    totalChunks++;
  }
}

console.log(`Indexed ${totalChunks} chunks from ${documents.length} documents`);

// Now search across all documents
const results = await searchManager.search('important concept', 10);
```

### Advanced: Custom Chunking Strategies

```typescript
import { 
  DocumentProcessor,
  SentenceTextSplitter,
  ParagraphTextSplitter 
} from './document-processing';

const processor = new DocumentProcessor({
  // Register multiple chunking strategies
  customChunkers: [
    { name: 'sentence', chunker: new SentenceTextSplitter({ chunkSize: 500 }) },
    { name: 'paragraph', chunker: new ParagraphTextSplitter({ chunkSize: 1200 }) },
  ],
  defaultChunkingStrategy: 'sentence'
});

// Use sentence-based chunking
const sentenceChunks = await processor.processDocument(
  file,
  'application/pdf',
  { 
    filename: 'article.pdf',
    chunkingStrategy: 'sentence'  // Override default
  }
);
```

### Retrieving Stored Documents

```typescript
// Access the ContentStore directly for advanced operations
const contentStore = searchManager.contentStore;

// Get a single document by ID
const document = await contentStore.documents.get('document_id');
if (document) {
  console.log(`ID: ${document.id}`);
  console.log(`Text: ${document.text}`);
}

// Get multiple documents in one call
const docIds = ['id1', 'id2', 'id3'];
const docs = await contentStore.getDocuments(docIds);
docs.forEach(doc => {
  if (doc) {
    console.log(doc.text);
  }
});

// Query all documents (useful for exports or backups)
const allDocs = await contentStore.documents.toArray();
console.log(`Total documents: ${allDocs.length}`);

// Delete a document (note: also remove from HNSW index separately)
await contentStore.documents.delete('document_id');

// Clear all documents
await contentStore.documents.clear();

// Check total number of indexed documents
const totalDocs = await searchManager.size();
console.log(`Indexed documents: ${totalDocs}`);
```

**Important**: The ContentStore is automatically managed by VectorSearchManager. When you call `addDocument()`, both the text storage and vector indexing happen together. If you delete from ContentStore directly, remember to also remove from the HNSW index if needed.

### Supported Document Formats

- **PDF**: Text extraction + OCR fallback for scanned documents (via pdf.js)
- **Images**: PNG, JPEG, GIF, BMP, TIFF with automatic OCR (via Tesseract.js)
- **Text**: Plain text, Markdown, JSON, CSV, and other text formats

See [document-processing/README.md](./document-processing/README.md) for detailed documentation on extractors, chunking strategies, and customization options.

## Use Cases

- **Documentation Search**: Semantic search through documentation with automatic chunking
- **PDF Analysis**: Extract, chunk, and search through PDF documents
- **Content Recommendation**: Find similar articles or products based on semantic similarity
- **FAQ Matching**: Match user questions to FAQ entries using semantic understanding
- **Chatbot Context**: Retrieve relevant context for conversational AI applications
- **Code Search**: Find similar code snippets semantically (not just keyword matching)
- **Document Q&A**: Question-answering over large document collections
- **Image Text Search**: OCR + search through scanned documents and images

## Quick Reference

### Common Patterns

**Simple text search:**
```typescript
const manager = new VectorSearchManager();
await manager.addDocument("Your text here");
const results = await manager.search("query", 5);
```

**Process and index a PDF:**
```typescript
const processor = new DocumentProcessor();
const chunks = await processor.processDocument(pdfFile, 'application/pdf');
for (const chunk of chunks) {
  await manager.addDocument(chunk.text);
}
```

**Custom embedding model:**
```typescript
const manager = new VectorSearchManager({
  embeddingEngine: new MyCustomEngine(),
});
```

**Access stored documents:**
```typescript
const doc = await manager.contentStore.documents.get('doc-id');
const totalDocs = await manager.size();
```

### Key Configuration Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `distanceFunction` | `'cosine-normalized'` | Distance metric for similarity |
| `m` | `16` | Graph connectivity (higher = better recall) |
| `efConstruction` | `200` | Build quality (higher = better index) |
| `chunkSize` | `1000` | Characters per chunk |
| `chunkOverlap` | `200` | Overlap between chunks |
| `enableOCRFallback` | `true` | OCR for scanned PDFs/images |

## Browser Compatibility

- **IndexedDB**: Required for persistence (supported in all modern browsers)
- **WebAssembly**: Required for transformers.js (supported in all modern browsers)

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npx tsc

# Run tests
npm test

# Run Mememo-specific tests (45 tests covering all optimizations)
npm test -- Mememo
```

## Performance Benchmarks

Based on test results with 384-dimensional embeddings:

| Operation | Before Optimization | After Optimization | Improvement |
|-----------|--------------------|--------------------|-------------|
| Query (100 nodes, 5 queries) | ~16ms | ~4ms avg | **~75% faster** |
| IndexedDB fetches (repeated queries) | Every prefetch | LRU cached | **~75% reduction** |
| Save (large index, small change) | Full export | Incremental | **~90% faster** |
| Page reload | Race condition crash | Stable | **100% reliable** |
| Memory usage | Unbounded growth | LRU eviction | **Stable at 50MB** |

**Test Coverage**: 45 comprehensive tests across 4 optimization phases
- Phase 1: Race condition fix (16 tests)
- Phase 2: LRU caching (6 tests)
- Phase 3: Cross-layer cache sharing (8 tests)
- Phase 4: Incremental saves (15 tests)

## License

ISC

## Credits

- **Mememo**: HNSW implementation by Jay Wang
- **Transformers.js**: HuggingFace transformers library for JavaScript
- **Dexie**: IndexedDB wrapper
