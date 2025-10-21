# Quick Reference Guide

## 🚀 Getting Started in 30 Seconds

```typescript
import VectorSearchManager from './embeddings/VectorSearchManager';

const manager = new VectorSearchManager();

// Add documents
await manager.addDocument("Machine learning is amazing");
await manager.addDocument("AI will change the world");

// Search
const results = await manager.search("artificial intelligence", 2);
console.log(results[0].text);
```

## 📄 Process a PDF

```typescript
import { DocumentProcessor } from './document-processing';
import VectorSearchManager from './embeddings/VectorSearchManager';

const processor = new DocumentProcessor();
const manager = new VectorSearchManager();

// Extract and chunk
const chunks = await processor.processDocument(pdfFile, 'application/pdf');

// Index all chunks
for (const chunk of chunks) {
  await manager.addDocument(chunk.text, `pdf_chunk_${chunk.index}`);
}

// Search
const results = await manager.search("your query");
```

## 💾 Access Stored Documents

```typescript
// Get one document
const doc = await manager.contentStore.documents.get("doc-id");

// Get multiple
const docs = await manager.contentStore.getDocuments(["id1", "id2"]);

// Get all
const all = await manager.contentStore.documents.toArray();

// Search with filter
const filtered = await manager.contentStore.documents
  .filter(d => d.text.includes("keyword"))
  .toArray();
```

## 🔧 Common Configurations

### Small Memory Footprint
```typescript
const manager = new VectorSearchManager({
  indexConfig: {
    m: 8,               // Fewer connections
    efConstruction: 100, // Faster build
    useIndexedDB: true   // Persist to disk
  }
});
```

### High Accuracy
```typescript
const manager = new VectorSearchManager({
  indexConfig: {
    m: 32,               // More connections
    efConstruction: 400, // Better quality
  }
});
```

### Custom Embeddings
```typescript
class MyEmbedding implements IEmbeddingEngine {
  async embed(text: string): Promise<number[]> {
    // Your embedding logic
    return yourEmbeddings;
  }
}

const manager = new VectorSearchManager({
  embeddingEngine: new MyEmbedding()
});
```

### Custom Chunking
```typescript
const processor = new DocumentProcessor({
  chunkingConfig: {
    chunkSize: 500,      // Smaller chunks
    chunkOverlap: 50,    // Less overlap
  },
  extractorConfig: {
    enableOCRFallback: true  // OCR for images
  }
});
```

## 📊 Storage Management

### Check Usage
```typescript
const total = await manager.size();
const allDocs = await manager.contentStore.documents.toArray();
const totalBytes = allDocs.reduce((sum, d) => sum + d.text.length, 0);

console.log(`Documents: ${total}`);
console.log(`Size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
```

### Export/Backup
```typescript
const backup = await manager.contentStore.documents.toArray();
const json = JSON.stringify(backup);
// Save json to file or server
```

### Import/Restore
```typescript
const restored = JSON.parse(backupJson);
for (const doc of restored) {
  await manager.addDocument(doc.text, doc.id);
}
```

### Clean Up
```typescript
// Delete one
await manager.contentStore.documents.delete("doc-id");

// Delete multiple
await manager.contentStore.documents.bulkDelete(["id1", "id2"]);

// Clear all
await manager.contentStore.documents.clear();
```

## 🎯 Best Practices

### ID Strategy
```typescript
// ✅ Good: Descriptive IDs
await manager.addDocument(text, "whitepaper_2024_intro");
await manager.addDocument(text, "faq_question_42");

// ❌ Avoid: Generic IDs
await manager.addDocument(text, "1");
```

### Batch Processing
```typescript
// ✅ Good: Process in batches
for (let i = 0; i < files.length; i += 10) {
  const batch = files.slice(i, i + 10);
  await Promise.all(batch.map(f => processFile(f)));
}

// ❌ Avoid: All at once (memory issues)
await Promise.all(files.map(f => processFile(f)));
```

### Error Handling
```typescript
// ✅ Good: Handle errors gracefully
for (const chunk of chunks) {
  try {
    await manager.addDocument(chunk.text, id);
  } catch (error) {
    console.error(`Failed: ${id}`, error);
    // Continue with others
  }
}
```

### Search Optimization
```typescript
// ✅ Good: Reasonable k value
const results = await manager.search(query, 10);

// ❌ Avoid: Very large k (slow)
const results = await manager.search(query, 1000);
```

## 🔍 Supported Formats

| Format | MIME Type | Example |
|--------|-----------|---------|
| PDF | `application/pdf` | `processor.processDocument(file, 'application/pdf')` |
| Text | `text/plain` | `processor.processDocument(file, 'text/plain')` |
| Markdown | `text/markdown` | `processor.processDocument(file, 'text/markdown')` |
| JSON | `application/json` | `processor.processDocument(file, 'application/json')` |
| PNG | `image/png` | `processor.processDocument(file, 'image/png')` |
| JPEG | `image/jpeg` | `processor.processDocument(file, 'image/jpeg')` |

## 📚 More Resources

- **DOCUMENT_STORAGE_GUIDE.md** - Complete storage guide
- **document-processing/README.md** - Document processing details
- **README.md** - Full documentation
- **INTEGRATION_GUIDE.md** - Integration examples
- **TEST_SUMMARY.md** - Test coverage and fixes

## 🆘 Troubleshooting

### No search results?
```typescript
const count = await manager.size();
console.log(`Documents indexed: ${count}`);
```

### Out of storage?
```typescript
if (navigator.storage?.estimate) {
  const { usage, quota } = await navigator.storage.estimate();
  console.log(`Used: ${((usage/quota)*100).toFixed(1)}%`);
}
```

### Slow processing?
```typescript
// Disable OCR if not needed
const processor = new DocumentProcessor({
  extractorConfig: { enableOCRFallback: false }
});
```

### Wrong results?
```typescript
// Try larger chunk sizes
const processor = new DocumentProcessor({
  chunkingConfig: { chunkSize: 1500 }
});
```

## 💡 Tips

1. **Start small**: Test with a few documents first
2. **Monitor storage**: Check usage before adding large batches
3. **Use IDs wisely**: Include metadata in your IDs
4. **Chunk appropriately**: 500-1500 characters works well
5. **Handle errors**: Always wrap in try-catch
6. **Test searches**: Verify results match expectations
7. **Clean up**: Delete old data you don't need
8. **Backup important data**: Export to JSON periodically

## 🎉 Example Projects

### Document Search Engine
```typescript
// Index all your PDFs
for (const pdf of pdfs) {
  const chunks = await processor.processDocument(pdf, 'application/pdf');
  for (const chunk of chunks) {
    await manager.addDocument(chunk.text, `${pdf.name}_${chunk.index}`);
  }
}

// Search interface
const results = await manager.search(userQuery, 5);
displayResults(results);
```

### FAQ Chatbot
```typescript
// Index FAQs
const faqs = [
  { q: "How do I reset password?", a: "Go to settings..." },
  { q: "Where is my order?", a: "Check tracking..." },
];

for (const faq of faqs) {
  await manager.addDocument(faq.q + " " + faq.a, `faq_${faq.id}`);
}

// Match user questions
const matches = await manager.search(userQuestion, 3);
const bestMatch = matches[0];
```

### Knowledge Base
```typescript
// Index documentation
const docs = await fetch('/api/docs').then(r => r.json());

for (const doc of docs) {
  await manager.addDocument(doc.content, doc.id);
}

// Semantic search
const results = await manager.search("how to configure", 10);
```
