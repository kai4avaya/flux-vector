# Document Processing System

A flexible, configurable document processing system that extracts text from various document formats and chunks it for semantic search.

## Features

- **📄 Multi-Format Support**: PDF, Text, Images (with OCR)
- **🔧 Configurable Extractors**: Easy to add custom document extractors
- **✂️ Smart Chunking**: Multiple chunking strategies (recursive, sentence, paragraph)
- **🎛️ Fully Customizable**: Replace any component with your own implementation
- **🔄 OCR Fallback**: Automatic OCR for scanned PDFs and images
- **📦 Batch Processing**: Process multiple documents efficiently

## Architecture

```
document-processing/
├── DocumentExtractor.ts      # Extract text from various formats
├── TextChunker.ts           # Split text into semantic chunks
├── DocumentProcessor.ts     # Orchestrate extraction + chunking
└── index.ts                 # Public API exports
```

## Quick Start

### Basic Usage

```typescript
import { DocumentProcessor } from './document-processing';

// Initialize processor
const processor = new DocumentProcessor();

// Process a PDF file
const file = // ... your file (File, Buffer, or ArrayBuffer)
const chunks = await processor.processDocument(
  file,
  'application/pdf',
  { filename: 'document.pdf' }
);

// Use the chunks
chunks.forEach(chunk => {
  console.log(chunk.text);
  console.log(chunk.metadata);
});
```

### With Custom Configuration

```typescript
import { DocumentProcessor } from './document-processing';

const processor = new DocumentProcessor({
  // Extraction config
  extractorConfig: {
    enableOCRFallback: true,
    ocrConfig: {
      languages: ['eng', 'spa'],
    },
  },
  
  // Chunking config
  chunkingConfig: {
    chunkSize: 1000,
    chunkOverlap: 200,
    separators: ['\n\n', '\n', '. ', ' '],
  },
  
  defaultChunkingStrategy: 'default',
});
```

## Supported Document Types

### Built-in Support

- **PDF**: Via pdf.js
  - Regular PDFs with selectable text
  - Scanned PDFs (with OCR fallback)
  
- **Text**: Plain text files
  - `.txt`, `.md`, `.json`, `.csv`, etc.
  
- **Images**: Via Tesseract.js OCR
  - PNG, JPEG, GIF, BMP, TIFF
  - Automatic text extraction from images

### Add Custom Extractors

```typescript
import { IDocumentExtractor } from './document-processing';

class CustomExtractor implements IDocumentExtractor {
  canHandle(mimeType: string): boolean {
    return mimeType === 'application/custom';
  }

  async extract(file: File | Buffer | ArrayBuffer): Promise<string> {
    // Your extraction logic
    return extractedText;
  }
}

// Register it
processor.registerExtractor(new CustomExtractor());
```

## Text Chunking Strategies

### 1. Recursive Character Splitter (Default)

Intelligently splits text by trying different separators:

```typescript
import { RecursiveCharacterTextSplitter } from './document-processing';

const chunker = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 200,
  separators: ['\n\n', '\n', '. ', '! ', '? ', ', ', ' '],
});
```

**Best for**: General purpose, maintains context

### 2. Sentence Splitter

Splits by sentences while respecting chunk size:

```typescript
import { SentenceTextSplitter } from './document-processing';

processor.registerChunker('sentence', new SentenceTextSplitter({
  chunkSize: 800,
  chunkOverlap: 100,
}));
```

**Best for**: Documents where sentence boundaries are important

### 3. Paragraph Splitter

Splits by paragraphs:

```typescript
import { ParagraphTextSplitter } from './document-processing';

processor.registerChunker('paragraph', new ParagraphTextSplitter({
  chunkSize: 1200,
  chunkOverlap: 150,
}));
```

**Best for**: Documents with clear paragraph structure

### Custom Chunking Strategy

```typescript
import { ITextChunker } from './document-processing';

class MyCustomChunker implements ITextChunker {
  chunk(text: string, options?: any): string[] {
    // Your chunking logic
    return chunks;
  }
}

processor.registerChunker('my-strategy', new MyCustomChunker());

// Use it
const chunks = await processor.processDocument(file, mimeType, {
  chunkingStrategy: 'my-strategy',
});
```

## Integration with Vector Search

```typescript
import { DocumentProcessor } from './document-processing';
import VectorSearchManager from './embeddings/VectorSearchManager';

const processor = new DocumentProcessor();
const searchManager = new VectorSearchManager();

// Process document
const chunks = await processor.processDocument(pdfFile, 'application/pdf', {
  filename: 'research-paper.pdf',
});

// Index all chunks
for (const chunk of chunks) {
  const docId = `${chunk.metadata.filename}_chunk_${chunk.index}`;
  await searchManager.addDocument(chunk.text, docId);
}

// Search
const results = await searchManager.search('quantum computing', 10);
```

## API Reference

### DocumentProcessor

#### Constructor

```typescript
new DocumentProcessor(config?: DocumentProcessorConfig)
```

**Config Options:**
- `extractorConfig`: Configuration for document extractors
- `chunkingConfig`: Configuration for text chunking
- `defaultChunkingStrategy`: Default strategy name
- `customExtractors`: Array of custom extractors to register
- `customChunkers`: Array of `{ name, chunker }` to register

#### Methods

##### `processDocument(file, mimeType, options?): Promise<ProcessedChunk[]>`

Process a single document.

**Parameters:**
- `file`: File | Buffer | ArrayBuffer
- `mimeType`: string
- `options`:
  - `filename`: string
  - `chunkingStrategy`: string
  - `chunkingConfig`: ChunkingConfig
  - `skipChunking`: boolean

**Returns:** Array of `ProcessedChunk` objects

##### `processBatch(documents, options?): Promise<ProcessedChunk[]>`

Process multiple documents.

**Parameters:**
- `documents`: Array of `{ file, mimeType, filename? }`
- `options`: Same as `processDocument` options

##### `registerExtractor(extractor: IDocumentExtractor): void`

Register a custom document extractor.

##### `registerChunker(name: string, chunker: ITextChunker): void`

Register a custom text chunker.

##### `getSupportedTypes(): string[]`

Get list of supported MIME types.

##### `getChunkingStrategies(): string[]`

Get list of available chunking strategies.

### ProcessedChunk

```typescript
interface ProcessedChunk {
  text: string;              // The chunk text
  index: number;             // Chunk index in document
  metadata: DocumentMetadata; // Document metadata
}
```

### DocumentMetadata

```typescript
interface DocumentMetadata {
  filename?: string;
  mimeType: string;
  size?: number;
  extractedAt: Date;
  chunkingStrategy?: string;
  totalChunks?: number;
}
```

## Configuration Examples

### Minimal Config (Use Defaults)

```typescript
const processor = new DocumentProcessor();
```

### Custom Chunk Sizes

```typescript
const processor = new DocumentProcessor({
  chunkingConfig: {
    chunkSize: 500,      // Smaller chunks
    chunkOverlap: 50,    // Less overlap
  },
});
```

### Disable OCR Fallback

```typescript
const processor = new DocumentProcessor({
  extractorConfig: {
    enableOCRFallback: false,
  },
});
```

### Multi-Language OCR

```typescript
const processor = new DocumentProcessor({
  extractorConfig: {
    ocrConfig: {
      languages: ['eng', 'fra', 'deu'], // English, French, German
    },
  },
});
```

### Multiple Custom Strategies

```typescript
const processor = new DocumentProcessor({
  customChunkers: [
    { name: 'small', chunker: new RecursiveCharacterTextSplitter({ chunkSize: 300 }) },
    { name: 'large', chunker: new RecursiveCharacterTextSplitter({ chunkSize: 2000 }) },
    { name: 'sentence', chunker: new SentenceTextSplitter() },
  ],
  defaultChunkingStrategy: 'small',
});
```

## Advanced Examples

### Processing Different File Types

```typescript
// PDF
await processor.processDocument(pdfFile, 'application/pdf');

// Text
await processor.processDocument(txtFile, 'text/plain');

// Markdown
await processor.processDocument(mdFile, 'text/markdown');

// Image (OCR)
await processor.processDocument(imageFile, 'image/png');

// JSON
await processor.processDocument(jsonFile, 'application/json');
```

### Batch Processing with Progress

```typescript
const documents = [/* array of files */];
const allChunks = [];

for (let i = 0; i < documents.length; i++) {
  const doc = documents[i];
  console.log(`Processing ${i + 1}/${documents.length}: ${doc.filename}`);
  
  const chunks = await processor.processDocument(
    doc.file,
    doc.mimeType,
    { filename: doc.filename }
  );
  
  allChunks.push(...chunks);
}

console.log(`Total chunks: ${allChunks.length}`);
```

### Skip Chunking for Small Documents

```typescript
const chunks = await processor.processDocument(file, mimeType, {
  skipChunking: true, // Returns single chunk with full text
});
```

## Dependencies

Install required packages:

```bash
npm install pdfjs-dist tesseract.js
```

For TypeScript support, types are included in the packages.

## Performance Tips

1. **Chunk Size**: Larger chunks = fewer embeddings but less precise search
2. **Overlap**: More overlap = better context but more redundancy
3. **Batch Processing**: Process multiple documents in parallel where possible
4. **OCR**: Disable if not needed (speeds up PDF processing)
5. **Custom Extractors**: Optimize for your specific document types

## Browser vs Node.js

### Browser
- Works with File API
- PDF.js uses CDN worker by default
- Tesseract.js downloads models on-demand

### Node.js
- Works with Buffer and fs
- May need to configure worker paths
- Can cache OCR models locally

## Troubleshooting

**PDF extraction returns empty:**
- Check if PDF has selectable text
- Enable OCR fallback for scanned PDFs
- Verify PDF is not corrupted

**OCR is slow:**
- Normal for large images
- Consider preprocessing images (resize, optimize)
- Use smaller language models if possible

**Chunks are too large/small:**
- Adjust `chunkSize` parameter
- Try different chunking strategies
- Check separator configuration

## License

ISC
