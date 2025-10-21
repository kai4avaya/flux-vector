# Flux-Vector Project Structure

```
flux-vector/
├── README.md                           # Main documentation
├── examples.ts                         # Usage examples
├── document-processing-examples.ts    # Document processing examples
├── package.json                        # Dependencies
│
├── mememo/                            # HNSW Vector Index Library
│   └── src/
│       ├── index.ts                   # Exports Mememo
│       └── mememo.ts                  # HNSW implementation
│
├── embeddings/                        # Embedding & Search Integration
│   ├── index.ts                       # Main exports
│   ├── ContentStore.ts                # IndexedDB text storage
│   ├── EmbeddingPipeline.ts          # Text → Vector conversion
│   └── VectorSearchManager.ts        # Complete search solution
│
└── document-processing/               # Document Processing Pipeline
    ├── README.md                      # Full documentation
    ├── index.ts                       # Main exports
    ├── DocumentExtractor.ts          # PDF, Text, Image extraction
    ├── TextChunker.ts                # Text chunking strategies
    └── DocumentProcessor.ts          # Orchestration layer
```

## Quick Reference

### Default Configuration
```typescript
{
  embeddingEngine: new DefaultEmbeddingEngine(),  // Xenova/all-MiniLM-L6-v2
  indexConfig: {
    distanceFunction: 'cosine-normalized',
    m: 16,
    efConstruction: 200,
    useIndexedDB: true,
  },
  chunkingConfig: {
    chunkSize: 1000,
    chunkOverlap: 200,
    separators: ['\n\n', '\n', '. ', '! ', '? ', ', ', ' '],
  }
}
```

## Component Flow

```
Document File
    ↓
DocumentExtractor → Extract Text (PDF.js, Tesseract OCR)
    ↓
TextChunker → Split into Chunks
    ↓
EmbeddingPipeline → Generate Embeddings (384-dim vectors)
    ↓
Mememo (HNSW) → Index Vectors
    ↓
VectorSearchManager → Unified Search API
    ↓
Search Results (with original text from ContentStore)
```

## Core Components

**Mememo (HNSW Index)**
- Fast approximate nearest neighbor search
- Configurable graph parameters
- IndexedDB persistence

**EmbeddingPipeline**
- Default: HuggingFace Transformers.js
- Interface for custom models
- 384-dimension embeddings (default)

**ContentStore**
- Stores original text documents
- IndexedDB-backed
- Efficient batch retrieval

**VectorSearchManager**
- Combines all components
- Simple API: `addDocument()`, `search()`
- Configurable via constructor

**DocumentProcessor**
- Multi-format support (PDF, images, text)
- Pluggable extractors and chunkers
- OCR fallback for scanned documents

## Getting Started

1. **Install dependencies**: `npm install`
2. **Use with defaults**: `const sm = new VectorSearchManager()`
3. **Add documents**: `await sm.addDocument("text")`
4. **Search**: `await sm.search("query", 10)`

## Advanced Features

### Custom Embedding Engine
```typescript
class MyEngine implements IEmbeddingEngine {
  async embed(text: string): Promise<number[]> {
    // Your embedding logic
  }
}

const manager = new VectorSearchManager({
  embeddingEngine: new MyEngine()
});
```

### Custom Document Extractor
```typescript
class MyExtractor implements IDocumentExtractor {
  canHandle(mimeType: string): boolean { /* ... */ }
  async extract(file: any): Promise<string> { /* ... */ }
}

processor.registerExtractor(new MyExtractor());
```

### Custom Text Chunker
```typescript
class MyChunker implements ITextChunker {
  chunk(text: string): string[] { /* ... */ }
}

processor.registerChunker('my-strategy', new MyChunker());
```

## Full Pipeline Example

```typescript
// 1. Setup
const processor = new DocumentProcessor();
const searchManager = new VectorSearchManager();

// 2. Process document
const chunks = await processor.processDocument(
  pdfFile,
  'application/pdf',
  { filename: 'doc.pdf' }
);

// 3. Index chunks
for (const chunk of chunks) {
  await searchManager.addDocument(chunk.text);
}

// 4. Search
const results = await searchManager.search('your query', 10);
```

See `examples.ts` and `document-processing-examples.ts` for detailed usage patterns.
