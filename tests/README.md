# Tests

Comprehensive test suite for flux-vector library.

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode (re-runs on file changes)
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run tests with verbose output
npm run test:verbose
```

## Test Structure

```
tests/
├── mocks/
│   └── MockEmbedding.ts          # Mock embedding engines for testing
├── ContentStore.test.ts           # ContentStore (IndexedDB) tests
├── TextChunker.test.ts            # Text chunking strategies tests
├── DocumentExtractor.test.ts      # Document extraction tests
├── DocumentProcessor.test.ts      # Document processing pipeline tests
├── VectorSearchManager.test.ts    # Vector search manager tests
└── Integration.test.ts            # End-to-end integration tests
```

## Test Coverage

### ContentStore.test.ts
Tests for the IndexedDB-based content storage system.

- ✅ Adding documents with IDs and text
- ✅ Updating existing documents
- ✅ Retrieving multiple documents
- ✅ Handling empty/long text
- ✅ Concurrent operations
- ✅ Special characters and unicode
- ✅ Database persistence

**Total: 20+ test cases**

### TextChunker.test.ts
Tests for text chunking strategies (Recursive, Sentence, Paragraph).

- ✅ Basic chunking with size limits
- ✅ Chunk overlap behavior
- ✅ Separator handling and priority
- ✅ Edge cases (empty text, small chunks, unicode)
- ✅ Comparison between strategies
- ✅ Sentence and paragraph splitting

**Total: 20+ test cases**

### DocumentExtractor.test.ts
Tests for document text extraction from various formats.

- ✅ Plain text extraction
- ✅ Markdown, JSON, CSV extraction
- ✅ MIME type detection (case-insensitive)
- ✅ Supported types listing
- ✅ Buffer, ArrayBuffer, Uint8Array handling
- ✅ Error handling for unsupported types
- ✅ Unicode and special character handling
- ✅ Whitespace preservation

**Total: 15+ test cases**

### DocumentProcessor.test.ts
Integration tests for the complete document processing pipeline.

- ✅ Basic document processing flow
- ✅ Metadata inclusion in chunks
- ✅ Sequential chunk indexing
- ✅ Multiple chunking strategies
- ✅ Custom chunking strategy registration
- ✅ Skip chunking option
- ✅ Different document formats (markdown, JSON)
- ✅ Edge cases (empty, short, unicode text)
- ✅ Configuration options

**Total: 25+ test cases**

### VectorSearchManager.test.ts
Tests for the vector search system integration.

- ✅ Adding documents with auto-generated/custom IDs
- ✅ Storage in ContentStore
- ✅ Indexing in vector index
- ✅ Search functionality with k parameter
- ✅ Result structure (key, text, distance)
- ✅ Distance score validation
- ✅ Complete workflow: add → search → retrieve
- ✅ Batch operations
- ✅ Custom embedding engines
- ✅ Configuration options
- ✅ Concurrent operations
- ✅ Direct ContentStore access

**Total: 30+ test cases**

### Integration.test.ts
End-to-end tests for the complete pipeline.

- ✅ Document processing → Vector search flow
- ✅ Multiple document indexing
- ✅ Metadata preservation through pipeline
- ✅ Batch processing efficiency
- ✅ Different document formats (text, markdown, JSON)
- ✅ Different chunking strategies
- ✅ Real-world scenarios:
  - Knowledge base building
  - FAQ matching
  - Multi-document search
- ✅ Error handling
- ✅ Performance characteristics

**Total: 20+ test cases**

## Total Test Coverage

- **130+ test cases** across all modules
- **6 test files** covering different components
- **Mock implementations** for fast testing
- **Integration tests** for end-to-end validation

## Mock Implementations

### MockEmbeddingEngine
Generates deterministic embeddings based on text content without requiring actual ML models.

```typescript
const mockEngine = new MockEmbeddingEngine(384);
const vector = await mockEngine.embed("test text");
```

### SimpleMockEmbedding
Lightweight mock with caching for faster tests.

```typescript
const simpleEngine = new SimpleMockEmbedding(10);
```

## Testing Dependencies

- **Jest**: Testing framework
- **ts-jest**: TypeScript support for Jest
- **@types/jest**: TypeScript definitions
- **fake-indexeddb**: IndexedDB mock for Node.js testing

## Notes

- Tests use `fake-indexeddb` to mock IndexedDB in Node.js environment
- Mock embedding engines provide fast, deterministic results
- Tests are isolated with proper setup/teardown
- Coverage reports are generated in `coverage/` directory
- Tests run with 30-second timeout for embedding operations

## Writing New Tests

Example test structure:

```typescript
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

describe('MyComponent', () => {
  let component: MyComponent;

  beforeEach(() => {
    // Setup before each test
    component = new MyComponent();
  });

  afterEach(() => {
    // Cleanup after each test
  });

  describe('feature X', () => {
    it('should do something', () => {
      const result = component.doSomething();
      expect(result).toBe(expectedValue);
    });

    it('should handle edge case', () => {
      expect(() => component.invalid()).toThrow();
    });
  });
});
```

## Continuous Integration

To run tests in CI/CD:

```yaml
# .github/workflows/test.yml
- name: Run tests
  run: npm test

- name: Upload coverage
  run: npm run test:coverage
```
