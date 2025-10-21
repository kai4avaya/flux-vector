# Progress Callbacks in Flux Vector

Flux Vector supports progress callbacks for tracking the progress of embedding operations. This is useful for providing user feedback during long-running operations.

## Features

### 1. Model Loading Progress

When the embedding model is first loaded, you can track the download and initialization progress:

```typescript
import { DefaultEmbeddingEngine } from './embeddings/EmbeddingPipeline';

// Create engine with model loading progress callback
const engine = new DefaultEmbeddingEngine((progress) => {
  console.log(`Model loading: ${progress.status} - ${Math.round(progress.progress * 100)}%`);
});

// First embed will trigger model loading
await engine.embed('Hello world');
```

### 2. Embedding Progress

Track the progress of individual embedding operations:

```typescript
import VectorSearchManager from './embeddings/VectorSearchManager';

const searchManager = new VectorSearchManager();

// Add document with progress callback
await searchManager.addDocument(
  'This is some text to embed',
  'doc-1',
  { source: 'example' },
  (progress) => {
    console.log(`Embedding progress: ${Math.round(progress * 100)}%`);
  }
);
```

### 3. Batch Processing with Progress

Track progress across multiple documents:

```typescript
const documents = [
  { id: 'doc1', text: 'First document' },
  { id: 'doc2', text: 'Second document' },
  { id: 'doc3', text: 'Third document' }
];

for (let i = 0; i < documents.length; i++) {
  const doc = documents[i];
  
  await searchManager.addDocument(
    doc.text,
    doc.id,
    {},
    (embeddingProgress) => {
      // Calculate overall progress
      const overallProgress = ((i + embeddingProgress) / documents.length) * 100;
      console.log(`Overall progress: ${Math.round(overallProgress)}%`);
    }
  );
}
```

## Progress Callback Signature

```typescript
type ProgressCallback = (progress: number) => void;
```

Where:
- `progress` is a number between 0 and 1 (0% to 100%)
- `0` means the operation just started
- `1` means the operation is complete

## Example: Real-time UI Updates

```typescript
// Update a progress bar in the UI
function updateProgressBar(progress) {
  const progressBar = document.getElementById('progress-bar');
  progressBar.style.width = `${progress * 100}%`;
  progressBar.textContent = `${Math.round(progress * 100)}%`;
}

// Process documents with progress updates
await searchManager.addDocument(
  documentText,
  'doc-id',
  metadata,
  updateProgressBar
);
```

## Progress Stages

The embedding progress callback reports progress through these stages:

1. **0%** - Operation started
2. **30%** - Model loaded (if needed)
3. **90%** - Embedding computed
4. **100%** - Operation complete

Note: After the first embedding, the model remains loaded, so subsequent embeddings will skip the 0-30% stage.

## API Reference

### DefaultEmbeddingEngine

```typescript
constructor(modelLoadCallback?: ProgressCallback)
```
- `modelLoadCallback`: Optional callback for model loading progress

```typescript
async embed(
  text: string, 
  progressCallback?: (progress: number) => void
): Promise<number[]>
```
- `text`: Text to embed
- `progressCallback`: Optional callback for embedding progress
- Returns: 384-dimension embedding vector

### VectorSearchManager

```typescript
async addDocument(
  text: string,
  id?: string,
  metadata?: Record<string, any>,
  progressCallback?: (progress: number) => void
): Promise<string>
```
- `text`: Text content to embed and index
- `id`: Optional document ID (generated if not provided)
- `metadata`: Optional metadata to store
- `progressCallback`: Optional callback for embedding progress
- Returns: Document ID

## Browser Example

See the `tests/website-tester` directory for a complete example of using progress callbacks in a browser application. The example includes:

- Visual progress bar
- Real-time progress updates
- Multi-document batch processing
- Per-chunk progress tracking

## Node.js Example

```typescript
import VectorSearchManager from './embeddings/VectorSearchManager';
import { DefaultEmbeddingEngine } from './embeddings/EmbeddingPipeline';

// Create engine with model loading progress
const engine = new DefaultEmbeddingEngine((progress) => {
  if (progress.status) {
    console.log(`${progress.status}: ${Math.round(progress.progress * 100)}%`);
  }
});

const searchManager = new VectorSearchManager({}, engine);

// Add document with embedding progress
await searchManager.addDocument(
  'Document text',
  'doc-1',
  {},
  (progress) => {
    process.stdout.write(`\rEmbedding: ${Math.round(progress * 100)}%`);
  }
);

console.log('\nDone!');
```

## Performance Considerations

- Progress callbacks are called multiple times per embedding operation
- Keep callback functions lightweight to avoid performance impact
- For batch operations, consider throttling UI updates
- The model loading callback is only triggered on first use

## Backward Compatibility

Progress callbacks are optional. Existing code without progress callbacks will continue to work:

```typescript
// Still works - no progress callback
await searchManager.addDocument('text', 'id', { metadata });
```
