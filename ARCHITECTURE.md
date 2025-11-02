# ARCHITECTURE

## System Overview
- The repository delivers a full-text vector search stack that spans document ingestion, chunking, embedding, storage, and interactive query tooling.
- Core runtime is written in TypeScript and targets both Node.js (for automated processing/tests) and browsers (for the Vite-powered playground).
- The `mememo` sub-module implements a Hierarchical Navigable Small World (HNSW) index with optional IndexedDB persistence, powering approximate nearest-neighbor search.
- High-level modules:
  - `document-processing`: extraction + chunking pipeline
  - `embeddings`: embedding orchestration, content persistence, and search manager
  - `mememo`: HNSW index core (graph + storage abstractions)
  - `tests/website-tester` & `mememo/examples`: browser evaluation harnesses

```mermaid
flowchart LR
  subgraph Ingestion [Document Ingestion]
    Raw[Raw Documents]
    DP[document-processing/DocumentProcessor]
    Chunker[TextChunkingManager]
    Raw --> DP --> Chunker
  end

  subgraph Embedding [Embedding & Storage]
    VSM[embeddings/VectorSearchManager]
    EP[embeddings/EmbeddingPipeline]
    CS[embeddings/ContentStore]
    HNSW[mememo/src/mememo]
  end

  subgraph Persistence [Persistence Layer]
    Dexie[Dexie \\nIndexedDB / WebSQL shim]
    IDX_DB["IndexedDB Store\\nmememo-index-store"]
  end

  Chunker -->|chunks| VSM
  VSM -->|text & metadata| CS
  VSM -->|vectors| HNSW
  CS --> Dexie
  HNSW --> IDX_DB
  EP -.->|model| VSM
  VSM -.->|progress callbacks| UI[Browser UI / CLI]
```

## Data Flow: Document Ingestion
```mermaid
sequenceDiagram
    participant User as User / Automation
    participant DP as DocumentProcessor
    participant EXT as Extractors (PDF/Image/Text)
    participant CH as TextChunkingManager
    participant VSM as VectorSearchManager
    participant EP as EmbeddingPipeline
    participant CS as ContentStore (Dexie)
    participant HNSW as Mememo HNSW Index

    User->>DP: processDocument(file, mimeType, options)
    DP->>EXT: extract(file)
    EXT-->>DP: raw text
    DP->>CH: chunk(text, strategy)
    CH-->>DP: chunk[]
    loop chunks
        DP->>VSM: addDocument(chunk.text, id, metadata, progressCb)
        VSM->>EP: embed(text, progressCb)
        EP-->>VSM: vector[384]
        VSM->>CS: put(id, text, metadata)
        VSM->>HNSW: insert(id, vector)
    end
    VSM-->>User: ids[]
```

## Query Flow
```mermaid
sequenceDiagram
    participant UI as UI / Test Harness
    participant VSM as VectorSearchManager
    participant EP as EmbeddingPipeline
    participant HNSW as Mememo HNSW
    participant CS as ContentStore

    UI->>VSM: search(query, k)
    VSM->>EP: embed(query)
    EP-->>VSM: queryVector
    VSM->>HNSW: query(vector, k)
    HNSW-->>VSM: {keys, distances}
    VSM->>CS: bulkGet(keys)
    CS-->>VSM: docs[]
    VSM-->>UI: results[{text, metadata, similarity}]
```

## Module Deep Dive

### Document Processing (`document-processing/`)
- `DocumentProcessor`: orchestrates extraction and chunking across heterogeneous environments (Node.js, browser). Accepts `File`, `Buffer`, or `ArrayBuffer` inputs and produces structured `ProcessedChunk` records.
- Extractors (`DocumentExtractor.ts`):
  - `PDFExtractor`: uses `pdfjs-dist`, falling back to OCR if text extraction is sparse. Handles `Buffer`, `File`, and `Uint8Array` gracefully.
  - `TextExtractor`: universal text handler using `TextDecoder` for browser environments and `Buffer` decoding in Node.
  - `ImageExtractor`: wraps `tesseract.js` with progress logging hooks.
- Chunkers (`TextChunker.ts`):
  - `RecursiveCharacterTextSplitter`: recursive separator strategy with overlap.
  - `SentenceTextSplitter` and `ParagraphTextSplitter` for higher-level segmentation.
  - `TextChunkingManager`: registry for custom chunkers with default fallback.

### Embedding Pipeline (`embeddings/`)
- `EmbeddingPipeline.ts`: lazy singleton around HuggingFace `pipeline('feature-extraction')`, defaulting to `Xenova/all-MiniLM-L6-v2`. Supports optional `progressCallback` for model loading and invocation phases (0%, 30%, 90%, 100%).
- `DefaultEmbeddingEngine`: ensures normalized mean-pooled embeddings (384 dims). Allows downstream substitution by injecting custom `IEmbeddingEngine` implementations (e.g., `MockEmbeddingEngine` in tests).
- `VectorSearchManager.ts`: system façade that connects chunk ingestion, embedding, storage, and vector indexing:
  - `addDocument`: emits embedding progress, persists text+metadata to Dexie-backed `ContentStore`, and inserts vectors into Mememo. UUID generated via `uuid` when absent.
  - `search`: transforms cosine distance into similarity score (`1 - distance`), merges metadata, and safeguards empty-index queries.
  - `updateDocument`: validates document exists, regenerates embedding, updates vector in HNSW index, and updates text in ContentStore.
  - `deleteDocument`: soft delete - removes from ContentStore, marks as deleted in HNSW (`markDeleted` flag), excluded from searches but kept in memory.
  - `compactIndex`: expensive hard delete operation (O(n log n)) - rebuilds entire index with only active nodes, permanently removing soft-deleted nodes and reclaiming memory.
  - `getDocument` / `hasDocument`: direct ContentStore lookups for document retrieval and existence checks.
  - `getStats`: introspects index health (total, active, and deleted node counts).

### Content Storage (`embeddings/ContentStore.ts`)
- Thin Dexie wrapper named `MyContentDatabase` with primary key `id`.
- Persists raw chunk text plus arbitrary metadata (`Record<string, any>`).
- Exposes `bulkGet`, `count`, and `clear` operations for integration tests and maintenance scripts.
- Shared between Node.js and browser contexts (Dexie polyfills WebSQL/localStorage where IndexedDB is unavailable).

### Mememo HNSW Engine (`mememo/src/mememo.ts`)
- Implements a configurable HNSW graph with both in-memory and IndexedDB-backed node stores.
- Key abstractions:
  - `Node`: encapsulates vector, key, and soft-delete flag.
  - `NodesInMemory`: simple `Map`-backed store for Node instances with optional distance cache.
  - `NodesInIndexedDB`: Dexie-backed store (`mememo-index-store`) supporting prefetching, LRU caching, and persistence across sessions.
  - `GraphLayer`: adjacency map per level with serialization helpers for export/import.
  - `HNSW`: orchestrates insertion, updates, lazy deletion, and multi-layer search per the original HNSW algorithm. Configurable via `HNSWConfig` parameters (`m`, `efConstruction`, distanceFn, etc.).

#### Performance Optimizations (2024 Q4)
The HNSW implementation includes four major performance optimizations:

1. **Ready Pattern (Race Condition Fix)**:
   - `ready()` method ensures safe initialization before any operations
   - Prevents race conditions where `NodesInIndexedDB.graphLayers` held stale references after async loads
   - All operations (`insert`, `query`, `update`, `bulkInsert`) await initialization completion
   - Eliminates crashes on page reload scenarios

2. **LRU Cache System**:
   - Custom `LRUCache<T>` class replaces unbounded `Map` storage
   - Automatic eviction when capacity reached (~16k nodes for 384-dim vectors at 50MB target)
   - Intelligent prefetch checks cache before hitting IndexedDB
   - **Result**: ~75% reduction in IndexedDB fetches for repeated queries

3. **Cross-Layer Cache Sharing**:
   - Enhanced `_prefetch()` explores neighbors from **all layers**, not just current layer
   - Distance penalty (0.1 per layer) ensures relevance while maximizing cache utilization
   - Breadth-first traversal with safe handling of missing nodes
   - **Result**: 100 nodes/5 queries in 19ms (4ms avg per query), ~75% faster than layer-isolated prefetch

4. **Incremental Saves with Dirty Tracking**:
   - `Set<string>` tracks dirty nodes, `Set<number>` tracks dirty layers
   - `incrementalSaveIndex()` only saves changed portions instead of entire graph
   - Configurable autosave with debouncing via `setAutosave(enabled, delayMs)`
   - `getDirtyStats()` provides visibility into pending changes
   - **Result**: ~90% faster saves for large indexes with small changes

- Persistence workflow:
  - When `useIndexedDB` is true, Mememo chooses `NodesInIndexedDB` for embedding storage.
  - Metadata regarding graph topology is saved in `indexMetadata` table (id = `graph`).
  - `saveIndex()`: serializes graph structure (layers, neighbors, connections) and configuration (m, efConstruction, distanceFn) to `indexMetadata` table.
  - `loadPersistedIndex()` & `_initializeFromPersistedData`: reconstruct graph structure on startup by deserializing from `indexMetadata`.
  - **Default behavior**: `clearOnInit` defaults to `true` (clears on init), set to `false` to enable persistence across sessions.
  - **Incremental saves**: `incrementalSaveIndex()` tracks dirty nodes/layers via `Set<string>` and `Set<number>`, only saves changed portions (~90% faster for small updates).
  - **Autosave**: `setAutosave(enabled, delayMs)` enables automatic background saves with configurable debouncing.
  - **Storage**: Embeddings persist automatically in `mememo` table; graph structure persists in `indexMetadata` when `clearOnInit: false`.

```mermaid
flowchart TB
    subgraph Mememo
        direction TB
        HNSWCore[HNSW]
        NodesStore{{Nodes
        InMemory / IndexedDB}}
        GraphLayers[[GraphLayer[]]]
        DistanceFns[(Distance Functions)]
    end
    subgraph IndexedDB
        DexieDb[Dexie Table: mememo]
        Metadata[Dexie Table: indexMetadata]
    end

    HNSWCore --> GraphLayers
    HNSWCore --> NodesStore
    HNSWCore --> DistanceFns
    NodesStore --> DexieDb
    HNSWCore --> Metadata
```

### Browser Playground (`tests/website-tester/` & `mememo/examples/rag-playground/`)
- Vite projects that bundle the compiled `dist/` artifacts for live experimentation.
- Provide drag-and-drop document uploads, progress reporting (`Embedding chunk X/Y`), similarity results, and metadata display.
- Use Dexie to persist documents and HNSW nodes in browser IndexedDB, enabling stateful experiences across sessions.
- Incorporate worker threads (`workers/embedding.ts`, `mememo-worker.ts`) to offload heavy vector work without freezing the UI.

### CRUD Operations Flow

**Create**: `addDocument(text, id)` → embed → store in ContentStore → insert into HNSW → return ID

**Read**: 
- `getDocument(id)`: Direct ContentStore lookup (O(1))
- `search(query, k)`: Embed query → HNSW search → fetch texts from ContentStore
- `hasDocument(id)`: Checks both ContentStore and HNSW for active status

**Update**: `updateDocument(id, newText)` → validate exists → re-embed → update HNSW vector → update ContentStore text

**Delete**:
- Soft: `deleteDocument(id)` → remove from ContentStore → `markDeleted` in HNSW (O(1), memory not reclaimed)
- Hard: `compactIndex()` → rebuild index with only active nodes (O(n log n), reclaims memory)

### Progress Callback Architecture

**Model Loading Progress**: Emitted by `DefaultEmbeddingEngine` constructor callback with `{status, progress}` object tracking download and initialization.

**Embedding Progress**: Optional callback parameter in `embed()` and `addDocument()` methods, reports 0%, 30%, 90%, 100% checkpoints:
- 0%: Operation started
- 30%: Model loaded (skipped after first use)
- 90%: Embedding computation complete
- 100%: Operation complete (stored and indexed)

**Progress Flow**: Callbacks propagate from `EmbeddingPipeline` → `VectorSearchManager` → user code, enabling UI updates during long-running operations.

### Testing & Tooling
- Jest test suite under `tests/` covers end-to-end ingestion, chunking, embedding, search, and CRUD flows with a `MockEmbeddingEngine` for deterministic assertions.
- `tests/ContentStore.crud.test.ts`, `tests/VectorSearchManager.test.ts`, etc., validate persistence, retrieval, and CRUD semantics.
- Progress callback behavior tested via mock engines that emit deterministic progress events.

## IndexedDB Integration Details
- `ContentStore` and `NodesInIndexedDB` each create their own Dexie instances (`MyContentDatabase`, `mememo-index-store`).
- `NodesInIndexedDB` prefetches neighbor embeddings with configurable `prefetchSize` (auto-calculated from target memory, default 50 MB) to reduce round-trips.
- Distance caching currently disabled by default (flagged for future optimization).
- **`clearOnInit` defaults to `true`**: Data is cleared on initialization by default. Set `clearOnInit: false` to enable persistence across sessions.

## Persistence Architecture

### IndexedDB Storage Structure

**Three separate databases:**
1. `MyContentDatabase` (ContentStore): Stores original text documents in `documents` table with schema `{id: string, text: string}`
2. `mememo-index-store` (HNSW nodes): Stores embeddings in `mememo` table with schema `{key: string, value: number[]}` 
3. `mememo-index-store` (Graph metadata): Stores graph structure in `indexMetadata` table with schema `{id: string, data: MememoIndexJSON}`

### Persistence States

**clearOnInit: true (default)**:
- IndexedDB cleared on each initialization
- Fresh start every session
- Use for development/testing or when persistence not needed

**clearOnInit: false (persistence mode)**:
- Graph structure automatically loaded from `indexMetadata` on construction
- Embeddings already in `mememo` table
- Requires async initialization wait (~100ms)
- Use for production apps needing cross-session persistence

### Save/Load Workflow

```
Save: HNSW graph → serialize to JSON → store in indexMetadata table
Load: Read from indexMetadata → deserialize JSON → reconstruct graph layers → connect to existing embeddings
```

## Identified Weaknesses & Risks
1. **Shared Dexie Schemas**: Database names (`MyContentDatabase`, `mememo-index-store`) are hard-coded. Multiple concurrent instances in the same origin risk clobbering each other; version upgrades require manual migration logic.
2. **Limited Persistence Contracts**: `ContentStore` stores metadata as `Record<string, any>` without schema versioning. Downstream consumers must guard against shape changes.
3. **Progress Granularity**: Embedding progress emits fixed checkpoints (0%, 30%, 90%, 100%), which may feel coarse for long documents. Lack of chunk-aware callbacks in `VectorSearchManager.addDocument` when invoked through batch pipelines.
4. **Synchronous Chunk Ingestion**: `addDocument` is awaited sequentially per chunk. Large document batches could benefit from batching embeddings or index insertions.
5. **Dexie in Node Context**: Dexie falls back to in-memory storage when IndexedDB is unavailable, which may confuse users expecting disk persistence in Node.js environments.
6. **Error Propagation**: `DocumentProcessor` logs extraction errors but generally throws raw `Error`s. Consider richer error typing (e.g., recoverable vs fatal) and structured logging for observability.
7. ~~**Mememo Distance Cache Disabled**~~: **RESOLVED** - LRU cache system now actively manages node caching with automatic eviction.
8. **Index Compaction Cost**: `VectorSearchManager.compactIndex` rebuilds the entire index synchronously, risking long stalls in browser contexts. Offloading to a worker or providing progress feedback would improve UX. *Note: Incremental saves reduce need for frequent compaction.*
9. **Security Considerations**: The browser playground loads external model assets and worker scripts; CSP headers or integrity checks are not configured, which might be relevant for production deployments.
10. **Update Operation Cost**: `updateDocument` requires full re-embedding and graph connection updates (O(log n)), not optimized for frequent updates.
11. **Soft Delete Memory Leak**: Soft-deleted nodes remain in memory until compaction. Long-running apps with many deletes should periodically call `compactIndex()`.

## Future Enhancements (Opportunities)
- Introduce configurable persistence adapters so downstream integrations can target SQLite/LevelDB in Node.js instead of Dexie’s abstractions.
- Augment `VectorSearchManager` with background compaction scheduling, soft-delete thresholds, and index export/import APIs.
- Expand progress callbacks to chunk-level events, enabling UI to display granularity per chunk rather than per document.
- Harden multi-environment support by abstracting file system versus browser blobs behind a single transport layer.
- Provide typed metadata interfaces or JSON schema validation to avoid silent runtime failures.

---
For detailed API usage, refer to `README.md`, `PROGRESS_CALLBACKS.md`, and in-code TypeDoc comments across the core modules (`document-processing`, `embeddings`, `mememo`).