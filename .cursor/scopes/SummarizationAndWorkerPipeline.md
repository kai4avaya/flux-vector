# Summarization and Worker Pipeline Implementation Plan

## Overview
This document outlines the plan to add summarization capabilities and migrate both embedding and summarization processing to Web Workers for improved performance and non-blocking operations.

## Best Practices Applied

This plan incorporates industry best practices for Web Worker architecture:

### Architecture
- ✅ **Single Worker Pattern**: One worker handles all task types (better resource sharing, simpler lifecycle)
- ✅ **Handler Registry**: Extensible handler pattern for adding new task types
- ✅ **Type Safety**: Discriminated unions for type-safe request/response handling
- ✅ **Separation of Concerns**: Clear separation between main thread (WorkerManager) and worker context (handlers)

### Communication
- ✅ **Structured Messages**: Type-safe request/response with discriminated unions
- ✅ **Request Correlation**: Map-based correlation for concurrent requests
- ✅ **Progress Reporting**: Separate message type for progress updates
- ✅ **Error Handling**: Structured error objects with codes and stack traces

### Resource Management
- ✅ **Model Caching**: Shared model cache across tasks with size limits
- ✅ **Lifecycle Management**: Proper worker creation, termination, and cleanup
- ✅ **Timeout Handling**: Per-task timeouts to prevent hanging operations
- ✅ **Memory Management**: Configurable cache size to prevent memory leaks

### Error Handling & Resilience
- ✅ **Error Boundaries**: Errors don't crash main thread
- ✅ **Graceful Degradation**: Fallback to main thread if workers unavailable
- ✅ **Health Monitoring**: Worker error detection and recovery
- ✅ **Structured Errors**: Error objects with message, code, and stack

### Testing & Maintainability
- ✅ **Testable Design**: Clear separation allows unit testing of handlers
- ✅ **Mock-Friendly**: Worker API can be mocked for testing
- ✅ **Build Tool Support**: Considerations for Vite/Webpack/Rollup
- ✅ **Documentation**: Comprehensive inline documentation and examples

## Goals
1. Add summarization functionality using Transformers.js (fastest model by default, customizable)
2. Migrate embedding processing to Web Workers
3. Run summarization in Web Workers in parallel with embeddings
4. Create a generic, reusable worker system
5. Persist summaries in a dedicated table linked to documents
6. Embed summaries after generation and store them in Mememo index
7. **Add summary search capability** - search similar summaries, link to documents
8. Maintain backward compatibility with existing code

## Current Architecture

### Existing Components
- **EmbeddingPipeline.ts**: Singleton pattern for embedding model, runs synchronously in main thread
- **ContentStore.ts**: Dexie database with `documents` table storing `{id, text, metadata}`
- **VectorSearchManager.ts**: Orchestrates embeddings and vector search using Mememo (HNSW)

### Current Flow
```
Document → EmbeddingPipeline.embed() → VectorSearchManager.addDocument() → ContentStore + Mememo Index
```

## Proposed Architecture

### New Components

#### 1. Worker System (`workers/`)
```
workers/
├── WorkerManager.ts          # Singleton worker manager (main thread)
├── worker-types.ts           # Shared TypeScript types/interfaces
├── worker-handlers.ts        # Task handler registry (worker context)
├── worker.ts                 # Main worker script (runs in worker context)
├── worker-utils.ts          # Shared utilities (model loading, etc.)
└── index.ts                  # Public API exports
```

**Best Practices Applied:**
- Single worker script handles all task types (better resource sharing)
- Handler pattern for extensibility
- Shared types ensure type safety across thread boundary
- Utilities module for reusable logic

#### 2. Summarization Pipeline (`embeddings/`)
```
embeddings/
├── SummarizationPipeline.ts  # Similar to EmbeddingPipeline but for summarization
└── (existing files...)
```

#### 3. Enhanced Content Store (`embeddings/`)
```
ContentStore.ts (updated)
- Add `summaries` table with schema:
  {
    id: string (primary key, same as document id),
    documentId: string (foreign key to documents.id),
    summaryText: string,
    summaryEmbedding: number[],
    model: string (model used for summarization),
    createdAt: number (timestamp),
    metadata?: Record<string, any>
  }
```

#### 4. Updated Vector Search Manager (`embeddings/`)
```
VectorSearchManager.ts (updated)
- Add summarization configuration options
- Add methods for summarization operations
- Update addDocument() to optionally generate summaries
```

## Detailed Implementation Plan

### Phase 1: Worker Infrastructure

#### 1.1 Create Worker Types (`workers/worker-types.ts`)
```typescript
// Shared types between main thread and workers
export enum WorkerTaskType {
  EMBED = 'embed',
  SUMMARIZE = 'summarize',
  EMBED_SUMMARY = 'embed_summary'
}

// Type-safe payloads for each task type
export interface EmbedTaskPayload {
  text: string;
  model?: string; // Optional model override
}

export interface SummarizeTaskPayload {
  text: string;
  model?: string;
  maxNewTokens?: number;
  minLength?: number;
  maxLength?: number;
}

// Discriminated union for type-safe requests
export type WorkerRequest = 
  | { id: string; task: WorkerTaskType.EMBED; payload: EmbedTaskPayload }
  | { id: string; task: WorkerTaskType.SUMMARIZE; payload: SummarizeTaskPayload }
  | { id: string; task: WorkerTaskType.EMBED_SUMMARY; payload: EmbedTaskPayload };

// Response types
export interface WorkerSuccessResponse<T = unknown> {
  id: string;
  type: 'success';
  data: T;
}

export interface WorkerErrorResponse {
  id: string;
  type: 'error';
  error: {
    message: string;
    code?: string;
    stack?: string;
  };
}

export interface WorkerProgressResponse {
  id: string;
  type: 'progress';
  progress: number; // 0-1
  stage?: string; // e.g., 'loading_model', 'processing', 'complete'
}

export type WorkerResponse = 
  | WorkerSuccessResponse 
  | WorkerErrorResponse 
  | WorkerProgressResponse;

// Worker configuration
export interface WorkerConfig {
  maxConcurrentTasks?: number; // Default: 1
  taskTimeout?: number; // Default: 5 minutes
  enableModelCache?: boolean; // Default: true
  modelCacheSize?: number; // Default: 2 (keep 2 models in memory)
}
```

#### 1.2 Create Worker Script (`workers/worker.ts`)
**Best Practices:**
- Single entry point worker script
- Handler registry pattern for extensibility
- Model caching with LRU eviction
- Proper error boundaries and cleanup
- Progress reporting via separate message type
- Timeout handling for long-running tasks

**Structure:**
```typescript
// workers/worker.ts (runs in worker context)
import { WorkerRequest, WorkerResponse, WorkerTaskType } from './worker-types';
import { handleEmbedTask, handleSummarizeTask } from './worker-handlers';

// Model cache (shared across tasks)
const modelCache = new Map<string, any>();

// Task handler registry
const handlers = {
  [WorkerTaskType.EMBED]: handleEmbedTask,
  [WorkerTaskType.SUMMARIZE]: handleSummarizeTask,
  [WorkerTaskType.EMBED_SUMMARY]: handleEmbedTask, // Reuse embed handler
};

// Main message handler
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  
  try {
    const handler = handlers[request.task];
    if (!handler) {
      throw new Error(`Unknown task type: ${request.task}`);
    }
    
    // Send progress updates
    const progressCallback = (progress: number, stage?: string) => {
      self.postMessage({
        id: request.id,
        type: 'progress',
        progress,
        stage,
      } as WorkerResponse);
    };
    
    // Execute task with timeout
    const result = await Promise.race([
      handler(request.payload, modelCache, progressCallback),
      createTimeout(request.id, 5 * 60 * 1000), // 5 min timeout
    ]);
    
    // Send success response
    self.postMessage({
      id: request.id,
      type: 'success',
      data: result,
    } as WorkerResponse);
    
  } catch (error) {
    // Send error response
    self.postMessage({
      id: request.id,
      type: 'error',
      error: {
        message: error instanceof Error ? error.message : String(error),
        code: error instanceof Error ? error.name : 'UnknownError',
        stack: error instanceof Error ? error.stack : undefined,
      },
    } as WorkerResponse);
  }
};

function createTimeout(requestId: string, ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Task ${requestId} timed out after ${ms}ms`));
    }, ms);
  });
}
```

#### 1.3 Create Worker Handlers (`workers/worker-handlers.ts`)
- Separate handlers for each task type
- Reusable model loading utilities
- Progress reporting integration
- Error handling per task type

#### 1.4 Create Worker Manager (`workers/WorkerManager.ts`)
**Best Practices:**
- Singleton pattern for worker lifecycle management
- Task queue with priority support
- Request/response correlation using Map
- Worker health monitoring
- Graceful degradation (fallback to main thread)
- Proper cleanup on termination

**Structure:**
```typescript
// workers/WorkerManager.ts (main thread)
import { WorkerRequest, WorkerResponse, WorkerConfig } from './worker-types';

interface PendingTask {
  request: WorkerRequest;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  progressCallback?: (progress: number) => void;
  timeoutId?: NodeJS.Timeout;
}

export class WorkerManager {
  private static instance: WorkerManager;
  private worker: Worker | null = null;
  private pendingTasks = new Map<string, PendingTask>();
  private taskQueue: WorkerRequest[] = [];
  private isProcessing = false;
  private config: Required<WorkerConfig>;
  
  private constructor(config?: WorkerConfig) {
    this.config = {
      maxConcurrentTasks: config?.maxConcurrentTasks ?? 1,
      taskTimeout: config?.taskTimeout ?? 5 * 60 * 1000,
      enableModelCache: config?.enableModelCache ?? true,
      modelCacheSize: config?.modelCacheSize ?? 2,
    };
  }
  
  static getInstance(config?: WorkerConfig): WorkerManager {
    if (!WorkerManager.instance) {
      WorkerManager.instance = new WorkerManager(config);
    }
    return WorkerManager.instance;
  }
  
  /**
   * Execute a task in a worker
   */
  async execute<T>(
    request: Omit<WorkerRequest, 'id'>,
    progressCallback?: (progress: number) => void
  ): Promise<T> {
    // Check if workers are supported
    if (typeof Worker === 'undefined') {
      throw new Error('Web Workers not supported. Use fallback mode.');
    }
    
    const id = this.generateRequestId();
    const fullRequest: WorkerRequest = { ...request, id } as WorkerRequest;
    
    return new Promise<T>((resolve, reject) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        this.pendingTasks.delete(id);
        reject(new Error(`Task ${id} timed out`));
      }, this.config.taskTimeout);
      
      // Store pending task
      this.pendingTasks.set(id, {
        request: fullRequest,
        resolve,
        reject,
        progressCallback,
        timeoutId,
      });
      
      // Ensure worker is initialized
      this.ensureWorker();
      
      // Send request
      this.worker!.postMessage(fullRequest);
    });
  }
  
  /**
   * Initialize worker if needed
   */
  private ensureWorker(): void {
    if (this.worker) return;
    
    // Create worker from bundled script
    // In production: use worker URL from build
    // In development: use inline worker or URL
    const workerUrl = this.getWorkerUrl();
    this.worker = new Worker(workerUrl, { type: 'module' });
    
    // Set up message handler
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      this.handleWorkerMessage(event.data);
    };
    
    // Handle worker errors
    this.worker.onerror = (error) => {
      console.error('Worker error:', error);
      this.handleWorkerError(error);
    };
    
    // Handle worker termination
    this.worker.onmessageerror = (error) => {
      console.error('Worker message error:', error);
      this.terminateWorker();
    };
  }
  
  /**
   * Handle messages from worker
   */
  private handleWorkerMessage(response: WorkerResponse): void {
    const pendingTask = this.pendingTasks.get(response.id);
    if (!pendingTask) {
      console.warn(`Received response for unknown task: ${response.id}`);
      return;
    }
    
    if (response.type === 'progress') {
      pendingTask.progressCallback?.(response.progress);
      return;
    }
    
    // Clear timeout
    if (pendingTask.timeoutId) {
      clearTimeout(pendingTask.timeoutId);
    }
    
    // Remove from pending
    this.pendingTasks.delete(response.id);
    
    // Handle response
    if (response.type === 'success') {
      pendingTask.resolve(response.data);
    } else if (response.type === 'error') {
      pendingTask.reject(new Error(response.error.message));
    }
  }
  
  /**
   * Handle worker errors
   */
  private handleWorkerError(error: ErrorEvent): void {
    // Reject all pending tasks
    for (const [id, task] of this.pendingTasks.entries()) {
      if (task.timeoutId) clearTimeout(task.timeoutId);
      task.reject(new Error(`Worker error: ${error.message}`));
    }
    this.pendingTasks.clear();
    
    // Terminate and cleanup
    this.terminateWorker();
  }
  
  /**
   * Terminate worker and cleanup
   */
  terminateWorker(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    
    // Reject all pending tasks
    for (const [id, task] of this.pendingTasks.entries()) {
      if (task.timeoutId) clearTimeout(task.timeoutId);
      task.reject(new Error('Worker terminated'));
    }
    this.pendingTasks.clear();
  }
  
  /**
   * Get worker URL (handles build/dev differences)
   */
  private getWorkerUrl(): string {
    // In production builds, this should point to bundled worker
    // For now, we'll use a data URL or require build tooling
    // This needs to be handled by build system (Vite/Webpack/etc.)
    return new URL('./worker.ts', import.meta.url).href;
  }
  
  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Cleanup (call when done)
   */
  destroy(): void {
    this.terminateWorker();
  }
}
```

**Key Features:**
- ✅ Type-safe request/response handling
- ✅ Request correlation with Map
- ✅ Timeout handling per task
- ✅ Progress callback support
- ✅ Error boundaries and recovery
- ✅ Worker lifecycle management
- ✅ Graceful degradation support

### Phase 2: Summarization Pipeline

#### 2.1 Create SummarizationPipeline (`embeddings/SummarizationPipeline.ts`)
```typescript
export interface ISummarizationEngine {
  summarize(
    text: string, 
    options?: SummarizationOptions,
    progressCallback?: (progress: number) => void
  ): Promise<string>;
}

export interface SummarizationOptions {
  maxNewTokens?: number;
  minLength?: number;
  maxLength?: number;
  model?: string; // Custom model override
}

export class DefaultSummarizationEngine implements ISummarizationEngine {
  // Uses Transformers.js summarization pipeline
  // Default model: Fastest available (e.g., 'Xenova/distilbart-cnn-6-6')
  // Supports custom model via options
}
```

**Implementation Details:**
- Similar singleton pattern to EmbeddingPipeline
- Uses `pipeline('summarization', modelName)` from Transformers.js
- Default model: Research fastest model, likely `Xenova/distilbart-cnn-6-6` or similar
- Supports progress callbacks for model loading and inference

### Phase 3: Enhanced Content Store

#### 3.1 Update ContentStore Schema
```typescript
// Add new table to ContentStore
summaries: Table<ISummary, string>

interface ISummary {
  id: string; // Same as document id
  documentId: string; // Foreign key reference
  summaryText: string;
  summaryEmbedding: number[]; // Embedding of the summary
  model: string; // Model used for summarization
  createdAt: number; // Timestamp
  metadata?: Record<string, any>;
}
```

**Database Version Migration:**
- Increment version to 2
- Add `summaries` table in migration
- Handle existing databases gracefully

#### 3.2 Add Summary Methods to ContentStore
```typescript
async addSummary(summary: ISummary): Promise<string>
async getSummary(documentId: string): Promise<ISummary | undefined>
async updateSummary(documentId: string, summary: Partial<ISummary>): Promise<void>
async deleteSummary(documentId: string): Promise<void>
async getSummaries(documentIds: string[]): Promise<(ISummary | undefined)[]>
```

### Phase 4: Worker Implementations

#### 4.1 Embedding Worker (`workers/embedding-worker.ts`)
- Wraps EmbeddingPipeline functionality
- Communicates via WorkerManager
- Handles embedding requests
- Returns embeddings to main thread
- Supports progress updates

#### 4.2 Summarization Worker (`workers/summarization-worker.ts`)
- Wraps SummarizationPipeline functionality
- Communicates via WorkerManager
- Handles summarization requests
- Returns summaries to main thread
- Supports progress updates

**Note:** Both workers can use the same generic worker script with different task handlers.

### Phase 5: Updated VectorSearchManager

#### 5.1 Add Summarization Configuration
```typescript
export interface VectorSearchConfig {
  // ... existing config ...
  
  /**
   * Summarization configuration
   */
  summarization?: {
    enabled?: boolean; // Default: false
    engine?: ISummarizationEngine;
    options?: SummarizationOptions;
    embedSummary?: boolean; // Whether to embed summaries (default: true)
  };
}
```

#### 5.2 Update addDocument Method
```typescript
async addDocument(
  text: string,
  id?: string,
  metadata?: Record<string, any>,
  progressCallback?: (progress: number) => void,
  options?: {
    generateSummary?: boolean; // Override config default
    waitForSummary?: boolean; // Wait for summary before returning (default: false)
  }
): Promise<{
  documentId: string;
  summaryId?: string; // If summary was generated
}>
```

**New Flow:**
1. Start embedding in worker (non-blocking)
2. If summarization enabled, start summarization in worker (parallel)
3. Store document when embedding completes
4. Store summary when summarization completes
5. Embed summary when summary completes (if enabled)
6. Store summary embedding in Mememo index with key `summary:${documentId}`
7. Link summary embedding to document for search

#### 5.3 Add Summary Methods
```typescript
async getSummary(documentId: string): Promise<ISummary | undefined>
async generateSummary(documentId: string, options?: SummarizationOptions): Promise<string>
async searchWithSummaries(queryText: string, k: number): Promise<ISearchResultWithSummary[]>

/**
 * Search for similar summaries (not documents).
 * Returns documents that have summaries matching the query.
 */
async searchSummaries(
  queryText: string, 
  k: number = 3
): Promise<ISummarySearchResult[]>

interface ISummarySearchResult {
  documentId: string;
  summaryText: string;
  distance: number;
  similarity: number;
  document?: IDocument; // Full document if requested
  metadata?: Record<string, any>;
}
```

#### 5.4 Summary Search Implementation Strategy

**Key Pattern:**
- Document embeddings: stored with key = `documentId` (e.g., `"doc-123"`)
- Summary embeddings: stored with key = `summary:${documentId}` (e.g., `"summary:doc-123"`)

**Search Process:**
1. Query Mememo index with query embedding
2. Filter results to only keys starting with `"summary:"`
3. Extract `documentId` from summary key (remove `"summary:"` prefix)
4. Lookup corresponding documents from ContentStore
5. Return summary text + linked document info

**Benefits:**
- Same HNSW index for both documents and summaries (efficient)
- Can search documents OR summaries independently
- Summary search results link back to full documents
- No need for separate index

**Example:**
```
Document ID: "doc-123"
├── Document embedding → Mememo key: "doc-123"
└── Summary embedding → Mememo key: "summary:doc-123"

Search Documents:
  Query → Mememo → Filter keys NOT starting with "summary:" → Return documents

Search Summaries:
  Query → Mememo → Filter keys starting with "summary:" → Extract doc IDs → Return summaries + documents
```

**Implementation Notes:**
- When storing summary embedding: `await index.insert(`summary:${documentId}`, summaryEmbedding)`
- When searching summaries: Filter `results.keys.filter(key => key.startsWith('summary:'))`
- When searching documents: Filter `results.keys.filter(key => !key.startsWith('summary:'))` (exclude summaries)
- Extract documentId from summary key: `key.replace('summary:', '')`
- Lookup document: `await contentStore.getDocument(documentId)`

**Important:** Update existing `search()` method to exclude summary keys to maintain document-only search behavior.

### Phase 6: Parallel Processing Strategy

#### 6.1 Task Coordination
- Embedding and summarization start simultaneously
- Both use WorkerManager for execution
- Progress callbacks can be combined or separate
- Results stored independently when ready

#### 6.2 Error Handling
- If embedding fails, document not stored
- If summarization fails, document still stored (summary optional)
- If summary embedding fails, summary stored without embedding
- All errors logged and reported to user

### Phase 7: Backward Compatibility

#### 7.1 Maintain Existing API
- All existing methods work as before
- Default behavior: summarization disabled
- Embedding still works synchronously if workers disabled (fallback)
- No breaking changes to public API

#### 7.2 Migration Path
- Existing code continues to work
- New features opt-in via configuration
- Workers can be disabled for testing/debugging

## File Structure

```
flux-vector/
├── workers/
│   ├── WorkerManager.ts           # Singleton worker manager
│   ├── worker-types.ts            # Shared types
│   ├── embedding-worker.ts        # Embedding worker wrapper
│   ├── summarization-worker.ts    # Summarization worker wrapper
│   └── generic-worker.ts          # Generic worker script
│
├── embeddings/
│   ├── EmbeddingPipeline.ts       # (Updated: Add worker support)
│   ├── SummarizationPipeline.ts  # (New)
│   ├── ContentStore.ts           # (Updated: Add summaries table)
│   ├── VectorSearchManager.ts     # (Updated: Add summarization)
│   └── index.ts                  # (Updated: Export new types)
│
├── tests/
│   ├── SummarizationPipeline.test.ts  # (New)
│   ├── WorkerManager.test.ts          # (New: Mock Worker API)
│   ├── worker-handlers.test.ts        # (New: Test handlers in isolation)
│   ├── worker.test.ts                 # (New: Test worker script)
│   ├── VectorSearchManager.summarization.test.ts  # (New)
│   ├── VectorSearchManager.summarySearch.test.ts  # (New: Test summary search)
│   └── (existing tests...)
│
└── (other existing files...)
```

## Implementation Order

1. **Phase 1**: Worker infrastructure 
   - Worker types with type-safe payloads
   - Worker script with handler registry
   - Worker handlers (embed + summarize)
   - WorkerManager with proper lifecycle management
   - Build configuration for worker bundling

2. **Phase 2**: SummarizationPipeline (can be tested independently)
   - Similar to EmbeddingPipeline
   - Can work in main thread initially, migrate to worker later

3. **Phase 3**: ContentStore updates (add summaries table)
   - Database migration
   - Summary CRUD methods

4. **Phase 4**: Integrate workers into pipelines
   - Update EmbeddingPipeline to use WorkerManager
   - Update SummarizationPipeline to use WorkerManager
   - Fallback to main thread if workers unavailable

5. **Phase 5**: VectorSearchManager updates (integrate everything)
   - Add summarization config
   - Update addDocument with parallel processing
   - Add summary search methods

6. **Phase 6**: Testing and refinement
   - Unit tests for all components
   - Integration tests
   - Performance testing
   - Error scenario testing

7. **Phase 7**: Documentation and examples
   - API documentation
   - Usage examples
   - Migration guide

## Technical Considerations

### Model Selection
- Research fastest Transformers.js summarization model
- Default: `Xenova/distilbart-cnn-6-6` (mentioned in docs) or similar
- Allow user override via config
- Consider model size vs speed tradeoff

### Worker Communication
**Best Practices:**
- ✅ Use `postMessage` / `onmessage` for worker communication
- ✅ Type-safe request/response with discriminated unions
- ✅ Request/response correlation via unique IDs (Map-based)
- ✅ Progress updates via separate message type
- ✅ Error handling with structured error objects
- ✅ Timeout handling per task
- ✅ Worker health monitoring

**Considerations:**
- Transferable objects for large data (future optimization)
- Consider Comlink library for better ergonomics (optional)
- Message chunking for very large payloads (if needed)

### Performance
**Best Practices:**
- ✅ Single worker with task queue (better resource sharing)
- ✅ Model caching with LRU eviction (shared across tasks)
- ✅ Workers run in parallel with main thread
- ✅ Configurable concurrency (start with 1, scale as needed)
- ✅ Memory management for model loading (limit cache size)
- ✅ Task prioritization (future: high-priority tasks first)
- ✅ Batch processing support (future: process multiple items)

**Optimizations:**
- Model preloading (optional: preload common models)
- Worker warm-up (optional: initialize worker on app start)
- Transferable objects for large embeddings (reduce copying)

### Storage
- Summaries linked to documents via `documentId`
- Summary embeddings stored in same ContentStore row
- **Summary embeddings indexed in same Mememo index** with key prefix `summary:${documentId}`
- Allows searching summaries independently while linking to documents
- Consider storage size implications

### Error Handling
**Best Practices:**
- ✅ Worker errors don't crash main thread
- ✅ Structured error objects with codes and stacks
- ✅ Graceful degradation (fallback to main thread if workers fail)
- ✅ Clear error messages for debugging
- ✅ Timeout handling (prevent hanging tasks)
- ✅ Worker health monitoring (detect and recover from failures)
- ✅ Retry logic for transient failures (configurable)
- ✅ Error boundaries per task type

**Error Recovery:**
- Auto-restart worker on critical errors
- Fallback to synchronous processing if worker unavailable
- User-configurable retry policies

## Testing Strategy

1. **Unit Tests**
   - WorkerManager functionality
   - SummarizationPipeline
   - ContentStore summary operations
   - Worker message handling

2. **Integration Tests**
   - End-to-end document + summary flow
   - Parallel embedding + summarization
   - Summary embedding
   - Error scenarios

3. **Performance Tests**
   - Worker vs main thread performance
   - Parallel processing benefits
   - Memory usage with workers

## Dependencies

### New Dependencies
- None (Transformers.js already installed)
- Web Workers are native browser API

### Optional Dependencies (Future Consideration)
- `comlink` - Better worker ergonomics (optional, can add later)
- `@types/web` - TypeScript types for Worker API (if needed)

### Build Tool Considerations
- **Vite**: Workers work out of the box with `?worker` suffix
- **Webpack**: Need worker-loader or similar
- **Rollup**: Need rollup-plugin-worker or similar
- **TypeScript**: Need proper worker type definitions

**Build Configuration:**
- Workers must be separate bundles
- Need to handle worker URLs in production builds
- Consider code splitting for worker code

## Migration Notes

- Existing databases will be migrated to version 2 automatically
- Existing code continues to work without changes
- New features are opt-in via configuration
- Workers can be disabled for debugging

## Future Enhancements

1. **Hybrid Search**: Combine document and summary search results
2. **Multi-model Support**: Different models for different document types
3. **Batch Processing**: Process multiple documents at once
4. **Worker Pool Scaling**: Dynamic worker pool based on load
5. **Summary Caching**: Cache summaries for similar documents
6. **Custom Summarization**: User-provided summarization functions
7. **Summary-only Index**: Optional separate index for summaries (if needed for performance)

## Success Criteria

1. ✅ Embeddings run in workers without blocking main thread
2. ✅ Summarization runs in parallel with embeddings
3. ✅ Summaries persist correctly in database
4. ✅ Summary embeddings are generated and stored in Mememo index
5. ✅ **Summary search works independently and links to documents**
6. ✅ Existing functionality remains intact
7. ✅ Performance improvement measurable
8. ✅ Code is well-tested and documented

## Questions to Resolve

1. **Default Summarization Model**: Confirm fastest model from Transformers.js
2. **Worker Pool Size**: Start with 1 or 2 workers?
3. **Summary Embedding**: Use same embedding model as documents? ✅ Yes (same model ensures compatibility)
4. **Progress Callbacks**: Combined or separate for embedding + summarization?
5. **Error Recovery**: How to handle partial failures (embedding succeeds, summary fails)?
6. **Summary Key Prefix**: Use `"summary:"` prefix? ✅ Yes (clear separation, easy filtering)
7. **Search Result Type**: Separate interface for summary search vs document search? ✅ Yes (ISummarySearchResult)

---

**Status**: Planning Phase
**Next Steps**: Review plan, resolve questions, begin Phase 1 implementation
