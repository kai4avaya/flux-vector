# Flux Vector Test Document

This is a **markdown** document used for testing the document processing pipeline.

## Features

The Flux Vector library provides:

1. Document extraction from multiple formats
2. Text chunking with configurable strategies
3. Embedding generation using transformer models
4. Vector search capabilities

## Testing

This document tests:

- Markdown formatting preservation
- Header extraction
- List processing
- **Bold** and *italic* text handling

## Code Example

```typescript
const processor = new DocumentProcessor();
const chunks = await processor.processDocument(file, 'text/markdown');
```

## Conclusion

This markdown file should be correctly processed by the DocumentProcessor and generate meaningful embeddings for semantic search.
