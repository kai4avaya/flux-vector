# Integration Guide: Document Processing → Storage → Search

This guide explains how all the components work together in flux-vector.

## The Complete Data Flow

```
┌─────────────┐
│   PDF/Image │
│     File    │
└──────┬──────┘
       │
       ▼
┌─────────────────────────────┐
│   DocumentProcessor         │
│  - Extracts text (PDF.js)   │
│  - OCR for images/scanned   │
│  - Chunks into pieces       │
└──────┬──────────────────────┘
       │
       ▼
┌─────────────────────────────┐
│  Array of ProcessedChunks   │
│  [{ text, index, metadata }]│
└──────┬──────────────────────┘
       │
       ▼ (for each chunk)
┌─────────────────────────────┐
│  VectorSearchManager        │
│  .addDocument(text, id)     │
└──────┬──────────────────────┘
       │
       ├──────────────────┬─────────────────┐
       ▼                  ▼                 ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Embedding   │  │ ContentStore │  │    Mememo    │
│   Engine     │  │  (IndexedDB) │  │ (HNSW Graph) │
│              │  │              │  │              │
│ text → vec   │  │ Stores text  │  │ Stores vec   │
└──────────────┘  └──────────────┘  └──────────────┘
```

## Understanding ContentStore

**Q: Where do my documents get stored when I process a PDF?**

A: When you call `searchManager.addDocument(chunk.text, id)`, the system automatically:

1. **Embeds** the text into a vector (array of numbers)
2. **Saves the original text** to `ContentStore` (an IndexedDB database)
3. **Indexes the vector** in the Mememo HNSW graph for fast search

**Q: Do I need to manually save to ContentStore?**

A: No! `VectorSearchManager.addDocument()` handles everything. You don't interact with ContentStore directly unless you want to retrieve documents outside of search.

## Step-by-Step Example

### 1. Process a PDF into Chunks

```typescript
import { DocumentProcessor } from './document-processing';

const processor = new DocumentProcessor({
  chunkingConfig: {
    chunkSize: 1000,
    chunkOverlap: 200,
  }
});

const chunks = await processor.processDocument(
  pdfFile,
  'application/pdf',
  { filename: 'myPDF.pdf' }
);

// chunks = [
//   { text: "First chunk of text...", index: 0, metadata: {...} },
//   { text: "Second chunk of text...", index: 1, metadata: {...} },
//   ...
// ]
```

### 2. Store Each Chunk in the Search Index

```typescript
import VectorSearchManager from './embeddings/VectorSearchManager';

const searchManager = new VectorSearchManager();

for (const chunk of chunks) {
  // Create a unique ID for this chunk
  const chunkId = `${chunk.metadata.filename}_chunk_${chunk.index}`;
  
  // This ONE call does everything:
  // - Embeds the text
  // - Saves original text to ContentStore
  // - Adds vector to HNSW index
  await searchManager.addDocument(chunk.text, chunkId);
}

console.log(`Indexed ${chunks.length} chunks`);
```

### 3. Search Across All Chunks

```typescript
// Search returns the original text + similarity score
const results = await searchManager.search('machine learning', 5);

results.forEach(result => {
  console.log(`ID: ${result.key}`);
  console.log(`Text: ${result.text}`);  // Original chunk text!
  console.log(`Distance: ${result.distance}`); // 0 = perfect match
  console.log('---');
});
```

## What Gets Stored Where?

### ContentStore (IndexedDB: "MyContentDatabase")
```typescript
{
  id: "myPDF.pdf_chunk_0",
  text: "First chunk of text from the PDF..."
}
```

### Mememo HNSW Index (IndexedDB: "mememo-db")
```typescript
{
  key: "myPDF.pdf_chunk_0",
  value: [0.234, -0.567, 0.123, ...], // 384-dimensional vector
  // + graph connections
}
```

**Both use the same ID/key** so they can be matched during search!

## Direct Access to ContentStore

If you need to access stored documents directly:

```typescript
// Get a single document
const doc = await searchManager.contentStore.documents.get('myPDF.pdf_chunk_0');
console.log(doc.text);

// Get multiple documents
const docs = await searchManager.contentStore.getDocuments([
  'myPDF.pdf_chunk_0',
  'myPDF.pdf_chunk_1',
]);

// Count all stored documents
const total = await searchManager.contentStore.documents.count();
console.log(`Total stored documents: ${total}`);

// List all document IDs
const allDocs = await searchManager.contentStore.documents.toArray();
allDocs.forEach(doc => console.log(doc.id));
```

## Common Patterns

### Pattern 1: Index Multiple PDFs

```typescript
const processor = new DocumentProcessor();
const searchManager = new VectorSearchManager();

const files = [
  { file: pdf1, filename: 'paper1.pdf' },
  { file: pdf2, filename: 'paper2.pdf' },
];

for (const { file, filename } of files) {
  const chunks = await processor.processDocument(file, 'application/pdf', { filename });
  
  for (const chunk of chunks) {
    await searchManager.addDocument(
      chunk.text,
      `${filename}_chunk_${chunk.index}`
    );
  }
}

// Now search across ALL indexed PDFs
const results = await searchManager.search('neural networks', 10);
```

### Pattern 2: Mix PDFs and Plain Text

```typescript
// Add PDF chunks
const pdfChunks = await processor.processDocument(pdfFile, 'application/pdf');
for (const chunk of pdfChunks) {
  await searchManager.addDocument(chunk.text);
}

// Add plain text directly (no chunking needed)
await searchManager.addDocument("Machine learning is a subset of AI.");
await searchManager.addDocument("Deep learning uses neural networks.");

// Search everything
const results = await searchManager.search('artificial intelligence');
```

### Pattern 3: OCR Images Then Search

```typescript
// Process an image with automatic OCR
const imageChunks = await processor.processDocument(
  imageFile,
  'image/png',
  { filename: 'diagram.png' }
);

// Index the extracted text
for (const chunk of imageChunks) {
  await searchManager.addDocument(chunk.text, `image_${chunk.index}`);
}

// Search the OCR'd text
const results = await searchManager.search('architecture diagram');
```

## Key Takeaways

1. **One call does it all**: `searchManager.addDocument(text, id)` handles embedding, storage, and indexing
2. **ContentStore is automatic**: You don't manually save to it; it's handled internally
3. **Same ID for everything**: Use the same ID for the text (ContentStore) and vector (Mememo)
4. **Chunking is separate**: DocumentProcessor creates chunks, VectorSearchManager stores them
5. **Search returns text**: Results include the original text from ContentStore, not just IDs

## Troubleshooting

**Q: My search returns IDs but no text**

A: The ContentStore might not have the document. Make sure you're using `addDocument()` not directly adding to the Mememo index.

**Q: Can I use ContentStore without VectorSearchManager?**

A: Yes, but you'd need to manually handle embeddings and indexing. VectorSearchManager is the recommended way.

**Q: How do I clear everything and start over?**

```typescript
// Clear the HNSW index
await searchManager.index.clear();

// Clear ContentStore
await searchManager.contentStore.documents.clear();
```

**Q: Can I change the chunking strategy after indexing?**

A: No, you'd need to re-process and re-index. The chunk boundaries affect search results.
