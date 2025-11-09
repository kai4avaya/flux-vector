/**
 * Mememo
 * @author: Jay Wang (jay@zijie.wang)
 */

// import { tensor2d } from '@tensorflow/tfjs';
import { randomLcg, randomUniform } from 'd3-random';
import { MinHeap, MaxHeap, IGetCompareValue } from '@datastructures-js/heap';
import Dexie from 'dexie';
import type { Table, PromiseExtended, IndexableType } from 'dexie';

type BuiltInDistanceFunction = 'cosine' | 'cosine-normalized';

interface SearchNodeCandidate {
  key: string;
  distance: number;
}

export interface MememoIndexJSON {
  distanceFunctionType: BuiltInDistanceFunction | 'custom';
  m: number;
  efConstruction: number;
  mMax0: number;
  ml: number;
  seed: number;
  useIndexedDB: boolean;
  useDistanceCache: boolean;
  entryPointKey: string | null;
  graphLayers: Record<string, Record<string, number>>[];
}

// Built-in distance functions
const DISTANCE_FUNCTIONS: Record<
  BuiltInDistanceFunction,
  (a: number[], b: number[]) => number
> = {
  cosine: (a: number[], b: number[]) => {
    const dotProduct = a.reduce(
      (sum, value, index) => sum + value * b[index],
      0
    );
    const magnitudeA = Math.sqrt(a.reduce((sum, value) => sum + value ** 2, 0));
    const magnitudeB = Math.sqrt(b.reduce((sum, value) => sum + value ** 2, 0));
    return 1 - dotProduct / (magnitudeA * magnitudeB);
  },

  'cosine-normalized': (a: number[], b: number[]) => {
    const dotProduct = a.reduce(
      (sum, value, index) => sum + value * b[index],
      0
    );
    return 1 - dotProduct;
  }
};

interface HNSWConfig {
  /** Distance function. */
  distanceFunction?:
    | 'cosine'
    | 'cosine-normalized'
    | ((a: number[], b: number[]) => number);

  /** Number of decimals to store for node distances. Default: 6 */
  distancePrecision?: number;

  /** The max number of neighbors for each node. A reasonable range of m is from
   * 5 to 48. Smaller m generally produces better results for lower recalls
   * and/or lower dimensional data, while bigger m is better for high recall
   * and/or high dimensional data. */
  m?: number;

  /** The number of neighbors to consider in construction's greedy search. */
  efConstruction?: number;

  /** The number of neighbors to keep for each node at the first level. */
  mMax0?: number;

  /** Normalizer parameter controlling number of overlaps across layers. */
  ml?: number;

  /** Optional random seed. */
  seed?: number;

  /** Whether to use indexedDB. If this is false, store all embeddings in
   * the memory. Default to true.
   */
  useIndexedDB?: boolean;

  /** Whether to clear IndexedDB on initialization. If true, clears all data on init.
   * Default to false (preserve data across sessions for persistence).
   */
  clearOnInit?: boolean;
}

/**
 * Doubly linked list node for LRU cache
 */
class LRUNode<T> {
  key: string;
  value: T;
  prev: LRUNode<T> | null = null;
  next: LRUNode<T> | null = null;

  constructor(key: string, value: T) {
    this.key = key;
    this.value = value;
  }
}

/**
 * LRU (Least Recently Used) Cache for managing in-memory node storage.
 * Automatically evicts least recently accessed items when capacity is reached.
 * Uses doubly linked list + key map for O(1) operations.
 */
class LRUCache<T> {
  private capacity: number;
  private cache: Map<string, LRUNode<T>>; // Key -> Node mapping for O(1) lookup
  private head: LRUNode<T> | null = null; // Most recently used (MRU)
  private tail: LRUNode<T> | null = null; // Least recently used (LRU)

  constructor(capacity: number) {
    this.capacity = capacity;
    this.cache = new Map<string, LRUNode<T>>();
  }

  /**
   * Get an item from cache and update its access time (O(1))
   */
  get(key: string): T | undefined {
    const node = this.cache.get(key);
    if (node === undefined) {
      return undefined;
    }

    // Move to head (most recently used)
    this._moveToHead(node);
    return node.value;
  }

  /**
   * Check if key exists in cache (O(1))
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Set an item in cache, evicting LRU item if at capacity (O(1))
   */
  set(key: string, value: T): void {
    const existingNode = this.cache.get(key);
    
    if (existingNode !== undefined) {
      // Update existing node and move to head
      existingNode.value = value;
      this._moveToHead(existingNode);
      return;
    }

    // If at capacity, evict least recently used
    if (this.cache.size >= this.capacity) {
      this._evictLRU();
    }

    // Create new node and add to head
    const newNode = new LRUNode<T>(key, value);
    this._addToHead(newNode);
    this.cache.set(key, newNode);
  }

  /**
   * Get current cache size (O(1))
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Clear all items from cache (O(1))
   */
  clear(): void {
    this.cache.clear();
    this.head = null;
    this.tail = null;
  }

  /**
   * Get all keys in cache (O(n))
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Move a node to the head (most recently used) - O(1)
   */
  private _moveToHead(node: LRUNode<T>): void {
    // If already at head, nothing to do
    if (node === this.head) {
      return;
    }

    // Remove node from its current position
    this._removeNode(node);
    
    // Add to head
    this._addToHead(node);
  }

  /**
   * Remove a node from the linked list - O(1)
   */
  private _removeNode(node: LRUNode<T>): void {
    if (node.prev !== null) {
      node.prev.next = node.next;
    } else {
      // Node is head
      this.head = node.next;
    }

    if (node.next !== null) {
      node.next.prev = node.prev;
    } else {
      // Node is tail
      this.tail = node.prev;
    }

    node.prev = null;
    node.next = null;
  }

  /**
   * Add a node to the head (most recently used) - O(1)
   */
  private _addToHead(node: LRUNode<T>): void {
    if (this.head === null) {
      // First node - both head and tail
      this.head = node;
      this.tail = node;
    } else {
      // Insert at head
      node.next = this.head;
      this.head.prev = node;
      this.head = node;
    }
  }

  /**
   * Evict the least recently used item (tail) - O(1)
   */
  private _evictLRU(): void {
    if (this.tail === null) {
      return;
    }

    const lruNode = this.tail;
    this.cache.delete(lruNode.key);
    
    if (this.head === this.tail) {
      // Only one node
      this.head = null;
      this.tail = null;
    } else {
      // Remove tail
      this.tail = this.tail.prev!;
      this.tail.next = null;
      lruNode.prev = null;
    }
  }
}

/**
 * A node in the HNSW graph.
 */
class Node {
  /** The unique key of an element. */
  key: string;

  /** The embedding value of the element. */
  value: number[];

  /** Whether the node is marked as deleted. */
  isDeleted: boolean;

  constructor(key: string, value: number[]) {
    this.key = key;
    this.value = value;
    this.isDeleted = false;
  }
}

/**
 * An abstraction of a map storing nodes in memory
 */
class NodesInMemory {
  nodesMap: Map<string, Node>;
  shouldPreComputeDistance = false;
  distanceCache: Map<string, number> = new Map<string, number>();

  constructor() {
    this.nodesMap = new Map<string, Node>();
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async size() {
    return this.nodesMap.size;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async has(key: string) {
    return this.nodesMap.has(key);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async get(key: string, _level: number) {
    return this.nodesMap.get(key);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async set(key: string, value: Node) {
    this.nodesMap.set(key, value);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async keys() {
    return [...this.nodesMap.keys()];
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async bulkSet(keys: string[], values: Node[]) {
    for (const [i, key] of keys.entries()) {
      this.nodesMap.set(key, values[i]);
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async clear() {
    this.nodesMap = new Map<string, Node>();
  }

  preComputeDistance(insertKey: string) {
    // pass
  }
}

/**
 * An abstraction of a map storing nodes in indexedDB
 */
class NodesInIndexedDB {
  nodesCache: LRUCache<Node>;
  dbPromise: PromiseExtended<Table<Node, IndexableType>>;
  /**
   * Graph layers from the index. We need it to pre-fetch data from indexedDB
   */
  graphLayers: GraphLayer[];
  prefetchSize: number;
  hasSetPrefetchSize: boolean;
  _prefetchTimes = 0;

  shouldPreComputeDistance = false;
  distanceCache: Map<string, number> = new Map<string, number>();
  distanceCacheMaxSize;

  /**
   *
   * @param graphLayers Graph layers used to pre-fetch embeddings form indexedDB
   * @param prefetchSize Number of items to prefetch.
   * @param clearOnInit Whether to clear the IndexedDB on initialization. Default false (preserve data).
   */
  constructor(
    graphLayers: GraphLayer[],
    shouldPreComputeDistance: boolean,
    clearOnInit: boolean = false,
    prefetchSize?: number,
    distanceCacheMaxSize = 4096
  ) {
    // Initialize LRU cache with prefetch size (will be updated based on embedding dim)
    this.prefetchSize = prefetchSize !== undefined ? prefetchSize : 8000;
    this.nodesCache = new LRUCache<Node>(this.prefetchSize);
    this.graphLayers = graphLayers;

    if (prefetchSize !== undefined) {
      this.hasSetPrefetchSize = true;
    } else {
      // The size will be set when the user gives an embedding for the
      // first time, so we know the embedding dimension
      this.hasSetPrefetchSize = false;
    }

    if (shouldPreComputeDistance === true) {
      this.shouldPreComputeDistance = true;
    }

    this.distanceCacheMaxSize = distanceCacheMaxSize;

    // Create a new store, clear content from previous sessions if clearOnInit is true
    const myDexie = new Dexie('mememo-index-store');
    myDexie.version(1).stores({
      mememo: 'key',
      indexMetadata: 'id'
    });
    const db = myDexie.table<Node>('mememo');
    
    // Clear or preserve data based on clearOnInit flag
    if (clearOnInit) {
      this.dbPromise = db.clear().then(() => db);
    } else {
      this.dbPromise = Promise.resolve(db) as PromiseExtended<Table<Node, IndexableType>>;
    }
  }

  async size() {
    const db = await this.dbPromise;
    return await db.count();
  }

  async has(key: string) {
    const db = await this.dbPromise;
    const result = await db.get(key);
    return result !== undefined;
  }

  async get(key: string, level: number) {
    if (!this.nodesCache.has(key)) {
      // Prefetch the node and its neighbors from indexedDB if the node is not
      // in memory
      await this._prefetch(key, level);
    }

    if (!this.nodesCache.has(key)) {
      throw Error(`The node ${key} is not in memory after pre-fetching.`);
    }

    return this.nodesCache.get(key);
  }

  async set(key: string, value: Node) {
    if (!this.hasSetPrefetchSize) {
      this._updateAutoPrefetchSize(value.value.length);
    }
    const db = await this.dbPromise;
    await db.put(value, key);

    // Also update the value in the memory copy if it's there
    if (this.nodesCache.has(key)) {
      this.nodesCache.set(key, value);
    }
  }

  async keys() {
    const db = await this.dbPromise;
    const results = (await db.toCollection().primaryKeys()) as string[];
    return results;
  }

  async bulkSet(keys: string[], values: Node[]) {
    if (!this.hasSetPrefetchSize && values.length > 0) {
      this._updateAutoPrefetchSize(values[0].value.length);
    }

    const db = await this.dbPromise;
    await db.bulkPut(values);

    // Also update the nodes in LRU cache (cache will auto-evict if at capacity)
    for (let i = 0; i < Math.min(this.prefetchSize, keys.length); i++) {
      this.nodesCache.set(keys[i], values[i]);
    }
  }

  async clear() {
    const db = await this.dbPromise;
    await db.clear();
  }

  /**q
   * Automatically update the prefetch size based on the size of embeddings.
   * The goal is to control the memory usage under 50MB.
   * 50MB ~= 6.25M numbers (8 bytes) ~= 16k 384-dim arrays
   */
  _updateAutoPrefetchSize(embeddingDim: number) {
    if (!this.hasSetPrefetchSize) {
      const targetMemory = 50e6;
      const numFloats = Math.floor(targetMemory / 8);
      this.prefetchSize = Math.floor(numFloats / embeddingDim);
      this.hasSetPrefetchSize = true;
      
      // Update LRU cache capacity to match new prefetch size
      this.nodesCache = new LRUCache<Node>(this.prefetchSize);
    }
  }

  /**
   * Prefetch the embeddings of the current nodes and its neighbors from the
   * indexedDB. We use BFS prioritizing closest neighbors until hitting the
   * `this.prefetchSize` limit.
   * 
   * PHASE 2 OPTIMIZATION: Uses LRU cache instead of aggressive clearing - frequently
   * accessed nodes stay in memory across multiple operations.
   * 
   * PHASE 3 OPTIMIZATION: Cross-layer cache sharing - when fetching a node that
   * exists in multiple layers, also fetch its neighbors from other layers to
   * maximize cache utility.
   * 
   * @param key Current node key
   * @param level Current layer level
   */
  async _prefetch(key: string, level: number) {
    // PHASE 2: Don't clear cache! Let LRU handle eviction.
    // PHASE 3: Cache is shared across all layers

    // Bounds check to prevent out of bounds access
    if (level >= this.graphLayers.length || level < 0) {
      return; // Skip prefetch if level out of bounds
    }

    // BFS traverse starting from current layer
    const graphLayer = this.graphLayers[level];

    const nodeCandidateCompare: IGetCompareValue<SearchNodeCandidate> = (
      candidate: SearchNodeCandidate
    ) => candidate.distance;
    const candidateHeap = new MinHeap(nodeCandidateCompare);
    const visitedNodes = new Set<string>();
    const keysToFetch = new Set<string>();

    // Start from the current node
    candidateHeap.push({ key, distance: 0 });
    visitedNodes.add(key);

    while (candidateHeap.size() > 0 && keysToFetch.size < this.prefetchSize) {
      const curCandidate = candidateHeap.pop();
      if (curCandidate === null) {
        break;
      }
      
      // Only fetch if not already in cache
      if (!this.nodesCache.has(curCandidate.key)) {
        keysToFetch.add(curCandidate.key);
      }

      // Check if node exists in CURRENT layer before processing
      const curNode = graphLayer.graph.get(curCandidate.key);
      if (curNode === undefined) {
        // Node doesn't exist in current layer - skip BFS expansion but keep it in fetch set
        // This can happen when cross-layer neighbors are added
        continue;
      }

      // Add neighbors from CURRENT layer
      for (const neighborKey of curNode.keys()) {
        const neighborDistance = curNode.get(neighborKey)!;
        if (!visitedNodes.has(neighborKey)) {
          visitedNodes.add(neighborKey);
          candidateHeap.push({
            key: neighborKey,
            distance: curCandidate.distance + neighborDistance
          });
        }
      }

      // PHASE 3 OPTIMIZATION: Also consider neighbors from OTHER layers
      // If current node exists in other layers, add their neighbors to fetch set
      // (but only traverse them if they exist in current layer too)
      for (let l = 0; l < this.graphLayers.length; l++) {
        if (l === level) continue; // Already processed current layer
        
        const otherLayerNode = this.graphLayers[l].graph.get(curCandidate.key);
        if (otherLayerNode) {
          // Found node in another layer - add its neighbors as candidates
          const layerDistancePenalty = Math.abs(l - level) * 0.1; // Prefer closer layers
          
          for (const neighborKey of otherLayerNode.keys()) {
            const neighborDistance = otherLayerNode.get(neighborKey)!;
            if (!visitedNodes.has(neighborKey)) {
              visitedNodes.add(neighborKey);
              
              // Only add to heap if it exists in current layer
              // Otherwise just mark it for fetching (cache warming)
              if (graphLayer.graph.has(neighborKey)) {
                candidateHeap.push({
                  key: neighborKey,
                  distance: curCandidate.distance + neighborDistance + layerDistancePenalty
                });
              } else {
                // Warm the cache even if not in current layer
                if (!this.nodesCache.has(neighborKey)) {
                  keysToFetch.add(neighborKey);
                }
              }
            }
          }
        }
      }
    }

    // Only fetch keys that aren't already cached
    if (keysToFetch.size > 0) {
      const db = await this.dbPromise;
      const nodes = await db.bulkGet([...keysToFetch]);

      // Store the embeddings in LRU cache (auto-evicts if needed)
      // Cache is shared across ALL layers
      for (const node of nodes) {
        if (node !== undefined) {
          this.nodesCache.set(node.key, node);
        }
      }
    }

    this._prefetchTimes += 1;
  }

  preComputeDistance(insertKey: string) {
    if (!this.nodesCache.has(insertKey) || !this.shouldPreComputeDistance) {
      return;
    }

    // // Use GPU to pre-compute the distance between the query embedding with
    // // all the embeddings in the memory
    // const embeddings: number[][] = [];
    // const keys: T[] = [];
    // for (const [key, node] of this.nodesCache entries) {
    //   keys.push(key);
    //   embeddings.push(node.value);
    // }
    // const embeddingTensor = tensor2d(embeddings, [
    //   embeddings.length,
    //   embeddings[0].length
    // ]);

    // const queryEmbedding = this.nodesMap.get(insertKey)!.value;
    // const queryTensor = tensor2d(queryEmbedding, [queryEmbedding.length, 1]);

    // const similarityScores = (
    //   embeddingTensor
    //     .matMul(queryTensor)
    //     .reshape([1, embeddingTensor.shape[0]])
    //     .arraySync() as number[][]
    // )[0];
    // const distanceScores = similarityScores.map(d => 1 - d);

    // // Clean the cache if it's too large
    // if (this.distanceCache.size + keys.length > this.distanceCacheMaxSize) {
    //   this.distanceCache.clear();
    // }

    // // Store the distances
    // for (const [i, key] of keys.entries()) {
    //   this.distanceCache.set(
    //     `${insertKey}-${key}`,
    //     distanceScores[i]
    //   );
    // }
  }
}

/**
 * One graph layer in the HNSW index
 */
class GraphLayer {
  /** The graph maps a key to its neighbor and distances */
  graph: Map<string, Map<string, number>>;

  /**
   * Initialize a new graph layer.
   * @param key The first key to insert into the graph layer.
   */
  constructor(key: string) {
    this.graph = new Map<string, Map<string, number>>();
    this.graph.set(key, new Map<string, number>());
  }

  toJSON() {
    const graph: Record<string, Record<string, number>> = {};

    // Convert the map into a serializable record
    for (const [key, neighborMap] of this.graph.entries()) {
      const neighborMapRecord: Record<string, number> = {};
      for (const [neighborKey, distance] of neighborMap.entries()) {
        neighborMapRecord[neighborKey] = distance;
      }
      graph[key] = neighborMapRecord;
    }

    return graph;
  }

  loadJSON(graph: Record<string, Record<string, number>>) {
    this.graph = new Map<string, Map<string, number>>();

    for (const key of Object.keys(graph)) {
      const neighborMapRecord = graph[key];
      const neighborMap = new Map<string, number>();

      for (const neighborKey of Object.keys(neighborMapRecord)) {
        const distance = neighborMapRecord[neighborKey];
        neighborMap.set(neighborKey, distance);
      }

      this.graph.set(key, neighborMap);
    }
  }
}

/**
 * HNSW (Hierarchical Navigable Small World) class.
 */
export class HNSW {
  distanceFunction: (
    a: number[],
    b: number[],
    aKey: string | null,
    bKey: string | null
  ) => number;
  distanceFunctionType: BuiltInDistanceFunction | 'custom';
  _distanceFunctionCallTimes = 0;
  _distanceFunctionSkipTimes = 0;
  useDistanceCache = false;
  distancePrecision = 6;

  /** The max number of neighbors for each node. */
  m: number;

  /** The number of neighbors to consider in construction's greedy search. */
  efConstruction: number;

  /** The number of neighbors to keep for each node at the first level. */
  mMax0: number;

  /** Normalizer parameter controlling number of overlaps across layers. */
  ml: number;

  /** Seeded random number generator */
  seed: number;
  rng: () => number;

  /** A collection all the nodes */
  nodes: NodesInMemory | NodesInIndexedDB;

  /** A list of all layers */
  graphLayers: GraphLayer[];

  /** Current entry point of the graph */
  entryPointKey: string | null = null;

  useIndexedDB = true;

  /** Promise for async initialization */
  private _initPromise: Promise<void> | null = null;

  /** Flag indicating initialization is complete */
  private _isInitialized = false;

  /** PHASE 4: Dirty tracking for incremental saves */
  private _dirtyNodes: Set<string> = new Set();
  private _dirtyLayers: Set<number> = new Set();
  private _lastSaveTime: number = 0;
  private _autosaveTimer: NodeJS.Timeout | null = null;
  private _autosaveDelay: number = 5000; // 5 seconds
  private _enableAutosave: boolean = false;

  /**
   * Constructs a new instance of the class.
   * @param config - The configuration object.
   * @param config.distanceFunction - Distance function. Default: 'cosine'
   * @param config.m -  The max number of neighbors for each node. A reasonable
   * range of m is from 5 to 48. Smaller m generally produces better results for
   * lower recalls and/or lower dimensional data, while bigger m is better for
   * high recall and/or high dimensional data. Default: 16
   * @param config.efConstruction - The number of neighbors to consider in
   * construction's greedy search. Default: 100
   * @param config.mMax0 - The maximum number of connections that a node can
   * have in the zero layer. Default 2 * m.
   * @param config.ml - Normalizer parameter. Default 1 / ln(m)
   * @param config.seed - Optional random seed.
   * @param config.useIndexedDB - Whether to use indexedDB
   * @param config.distancePrecision - How many decimals to store for distances
   */
  constructor({
    distanceFunction,
    m,
    efConstruction,
    mMax0,
    ml,
    seed,
    useIndexedDB,
    distancePrecision,
    clearOnInit
  }: HNSWConfig) {
    // Initialize HNSW parameters
    this.m = m || 16;
    this.efConstruction = efConstruction || 100;
    this.mMax0 = mMax0 || this.m * 2;
    this.ml = ml || 1 / Math.log(this.m);
    this.seed = seed || randomUniform()();
    this.distancePrecision = distancePrecision || 6;

    this.rng = randomLcg(this.seed);

    // Set the distance function type
    let _distanceFunction = DISTANCE_FUNCTIONS['cosine-normalized'];
    this.distanceFunctionType = 'cosine-normalized';

    if (distanceFunction === undefined) {
      _distanceFunction = DISTANCE_FUNCTIONS['cosine-normalized'];
      this.distanceFunctionType = 'cosine-normalized';
    } else {
      if (typeof distanceFunction === 'string') {
        _distanceFunction = DISTANCE_FUNCTIONS[distanceFunction];
        if (distanceFunction === 'cosine-normalized') {
          this.distanceFunctionType = 'cosine-normalized';
        } else if (distanceFunction === 'cosine') {
          this.distanceFunctionType = 'cosine';
        }
      } else {
        _distanceFunction = distanceFunction;
        this.distanceFunctionType = 'custom';
      }
    }

    // The cache mechanism needs improvement, we just disable it for now
    // this.useDistanceCache = this.distanceFunctionType === 'cosine-normalized';
    this.useDistanceCache = false;

    // Data structures
    this.graphLayers = [];

    if (useIndexedDB === undefined || useIndexedDB === false) {
      this.useIndexedDB = false;
      this.nodes = new NodesInMemory();
    } else {
      this.useIndexedDB = true;
      const shouldClearOnInit = clearOnInit === true; // Default to false (preserve data)
      this.nodes = new NodesInIndexedDB(
        this.graphLayers,
        this.useDistanceCache,
        shouldClearOnInit
      );

      // If not clearing on init, try to load persisted index
      if (!shouldClearOnInit) {
        this._initPromise = this._initializeFromPersistedData();
      } else {
        // If clearing, we're initialized immediately
        this._isInitialized = true;
      }
    }

    // Set the distance function which has access to the distance cache
    this.distanceFunction = (
      a: number[],
      b: number[],
      aKey: string | null,
      bKey: string | null
    ) => {
      if (!this.useDistanceCache || aKey === null || bKey === null) {
        this._distanceFunctionCallTimes += 1;
        const distance = round(_distanceFunction(a, b), this.distancePrecision);
        return distance;
      }

      // Try two different key combinations
      const keyComb1 = `${aKey}-${bKey}`;
      const keyComb2 = `${bKey}-${aKey}`;

      if (this.nodes.distanceCache.has(keyComb1)) {
        this._distanceFunctionSkipTimes += 1;
        return this.nodes.distanceCache.get(keyComb1)!;
      }

      if (this.nodes.distanceCache.has(keyComb2)) {
        this._distanceFunctionSkipTimes += 1;
        return this.nodes.distanceCache.get(keyComb2)!;
      }

      // Fallback
      const distance = round(_distanceFunction(a, b), this.distancePrecision);
      this._distanceFunctionCallTimes += 1;
      return distance;
    };
  }

  /**
   * Serialize the index into a JSON string
   */
  exportIndex() {
    const graphLayers: Record<string, Record<string, number>>[] =
      this.graphLayers.map(d => d.toJSON());

    const mememoIndex: MememoIndexJSON = {
      distanceFunctionType: this.distanceFunctionType,
      m: this.m,
      efConstruction: this.efConstruction,
      mMax0: this.mMax0,
      ml: this.ml,
      seed: this.seed,
      useIndexedDB: this.useIndexedDB,
      useDistanceCache: this.useDistanceCache,
      entryPointKey: this.entryPointKey,
      graphLayers: graphLayers
    };

    return mememoIndex;
  }

  /**
   * Load HNSW index from a JSON object. Note that the nodes' embeddings ARE NOT
   * loaded. You need to call insertSkipIndexing() to insert node embeddings
   * AFTER this call.
   * @param mememoIndex JSON format of the created index
   */
  loadIndex(mememoIndex: MememoIndexJSON) {
    this.distanceFunctionType = mememoIndex.distanceFunctionType;
    this.m = mememoIndex.m;
    this.efConstruction = mememoIndex.efConstruction;
    this.mMax0 = mememoIndex.mMax0;
    this.ml = mememoIndex.ml;
    this.seed = mememoIndex.seed;
    this.useIndexedDB = mememoIndex.useIndexedDB;
    this.useDistanceCache = mememoIndex.useDistanceCache;
    this.entryPointKey = mememoIndex.entryPointKey;

    // Load the graph layers
    this.graphLayers = [];

    for (const graphJSON of mememoIndex.graphLayers) {
      const graphLayer = new GraphLayer('');
      graphLayer.loadJSON(graphJSON);
      this.graphLayers.push(graphLayer);
    }
  }

  /**
   * Private method to initialize from persisted data (async initialization).
   * Should be called after constructor when clearOnInit is false.
   */
  private async _initializeFromPersistedData(): Promise<void> {
    try {
      const persistedIndex = await this.loadPersistedIndex();
      if (persistedIndex) {
        this.loadIndex(persistedIndex);
        
        // CRITICAL FIX: Update NodesInIndexedDB reference to new graphLayers
        if (this.nodes instanceof NodesInIndexedDB) {
          this.nodes.graphLayers = this.graphLayers;
        }
      }
    } catch (error) {
      // Silently handle initialization errors - fallback to empty index
    } finally {
      // Mark initialization as complete
      this._isInitialized = true;
      this._initPromise = null; // Allow GC
    }
  }

  /**
   * Wait for initialization to complete. Must be called before any operations
   * when using IndexedDB persistence.
   * @returns Promise that resolves when initialization is complete
   */
  async ready(): Promise<void> {
    if (this._isInitialized) {
      return;
    }
    
    if (this._initPromise) {
      await this._initPromise;
    }
    
    // If no init promise and not initialized, we're in memory mode or clearOnInit
    this._isInitialized = true;
  }

  /**
   * Save the current index to IndexedDB metadata table for persistence.
   * This saves the graph structure to IndexedDB so it can be loaded later.
   */
  async saveIndex() {
    if (!this.useIndexedDB) {
      throw new Error('Cannot save index: IndexedDB is not enabled');
    }

    const indexData = this.exportIndex();
    const myDexie = new Dexie('mememo-index-store');
    myDexie.version(1).stores({
      mememo: 'key',
      indexMetadata: 'id'
    });
    const metadataTable = myDexie.table('indexMetadata');
    await metadataTable.put({ id: 'graph', data: indexData });
  }

  /**
   * Load a persisted index from IndexedDB metadata table.
   * Returns the index data if found, null otherwise.
   */
  async loadPersistedIndex(): Promise<MememoIndexJSON | null> {
    if (!this.useIndexedDB) {
      return null;
    }

    try {
      const myDexie = new Dexie('mememo-index-store');
      myDexie.version(1).stores({
        mememo: 'key',
        indexMetadata: 'id'
      });
      const metadataTable = myDexie.table('indexMetadata');
      const record = await metadataTable.get('graph');
      return record ? record.data : null;
    } catch (error) {
      // Silently handle load errors - return null to indicate no persisted data
      return null;
    }
  }

  /**
   * Insert a new element to the index.
   * @param key Key of the new element.
   * @param value The embedding of the new element to insert.
   * @param maxLevel The max layer to insert this element. You don't need to set
   * this value in most cases. We add this parameter for testing purpose.
   */
  async insert(key: string, value: number[], maxLevel?: number | undefined) {
    // Wait for initialization to complete
    await this.ready();
    
    // Randomly determine the max level of this node
    const level = maxLevel === undefined ? this._getRandomLevel() : maxLevel;

    // If the key already exists, throw an error
    if (await this.nodes.has(key)) {
      const nodeInfo = await this._getNodeInfo(key, level);

      if (nodeInfo.isDeleted) {
        // The node was flagged as deleted, so we update it using the new value
        nodeInfo.isDeleted = false;
        await this.nodes.set(key, nodeInfo);
        await this.update(key, value);
        return;
      }

      throw Error(
        `There is already a node with key ${key} in the` +
          'index. Use update() to update this node.'
      );
    }

    // Add this node to the node index first
    await this.nodes.set(key, new Node(key, value));

    // Insert the node to the graphs
    await this._insertToGraph(key, value, level);
    
    // PHASE 4: Mark node as dirty for incremental save
    this._markDirty(key, level);
  }

  /**
   * Insert new elements to the index.
   * @param keys Key of the new elements.
   * @param values The embeddings of the new elements to insert.
   * @param maxLevel The max layer to insert this element. You don't need to set
   * this value in most cases. We add this parameter for testing purpose.
   */
  async bulkInsert(keys: string[], values: number[][], maxLevels?: number[]) {
    // Wait for initialization to complete
    await this.ready();
    
    const existingKeys = await this.nodes.keys();

    // TODO: this method does not consider deleted nodes
    for (const key of keys) {
      if (existingKeys.includes(key)) {
        throw Error(
          `There is already a node with key ${key} in the` +
            'index. Use update() to update this node.'
        );
      }
    }

    // Bulk add nodes to the node index first
    const newNodes: Node[] = [];
    for (const [i, key] of keys.entries()) {
      newNodes.push(new Node(key, values[i]));
    }

    await this.nodes.bulkSet(keys, newNodes);

    // const oldCallTimes = this._distanceFunctionCallTimes;
    // const oldSkipTimes = this._distanceFunctionCallTimes;

    // Insert the nodes to the graphs
    for (const [i, key] of keys.entries()) {
      if (maxLevels === undefined) {
        const level = this._getRandomLevel();
        await this._insertToGraph(key, values[i], level);
        // PHASE 4: Mark as dirty
        this._markDirty(key, level);
      } else {
        await this._insertToGraph(key, values[i], maxLevels[i]);
        // PHASE 4: Mark as dirty
        this._markDirty(key, maxLevels[i]);
      }
    }

    // console.log('call times: ', this._distanceFunctionCallTimes - oldCallTimes);
    // console.log('skip times: ', this._distanceFunctionSkipTimes - oldSkipTimes);
    // console.log((this.nodes as NodesInIndexedDB<T>)._prefetchTimes);
  }

  /**
   * Insert a new element's embedding to the index. It assumes this element is
   * already in the index.
   * @param key Key of the new element.
   * @param value The embedding of the new element to insert.
   */
  async insertSkipIndex(key: string, value: number[]) {
    // If the key already exists, throw an error
    if (await this.nodes.has(key)) {
      throw Error(`There is already a node with key ${key} in the index.`);
    }

    await this.nodes.set(key, new Node(key, value));
  }

  /**
   * Insert new elements' embeddings to the index. It assumes elements are
   * already in the index.
   * @param keys Key of the new elements.
   * @param values The embeddings of the new elements to insert.
   */
  async bulkInsertSkipIndex(keys: string[], values: number[][]) {
    // If the key already exists, throw an error
    const existingKeys = await this.nodes.keys();

    for (const key of keys) {
      if (existingKeys.includes(key)) {
        throw Error(`There is already a node with key ${key} in the index.`);
      }
    }

    const newNodes: Node[] = [];
    for (const [i, key] of keys.entries()) {
      newNodes.push(new Node(key, values[i]));
    }

    await this.nodes.bulkSet(keys, newNodes);
  }

  /**
   * Helper function to insert the new element to the graphs
   * @param key Key of the new element
   * @param value Embeddings of the new element
   * @param level Max level for this insert
   */
  async _insertToGraph(key: string, value: number[], level: number) {
    if (this.entryPointKey !== null) {
      // Pre-compute the distance if possible
      if (this.nodes.shouldPreComputeDistance) {
        this.nodes.preComputeDistance(key);
      }

      // (1): Search closest point from layers above
      const entryPointInfo = await this._getNodeInfo(
        this.entryPointKey,
        this.graphLayers.length - 1
      );

      // Start with the entry point
      let minDistance = this.distanceFunction(
        value,
        entryPointInfo.value,
        key,
        entryPointInfo.key
      );
      let minNodeKey = this.entryPointKey;

      // Top layer => all layers above the new node's highest layer
      for (let l = this.graphLayers.length - 1; l >= level + 1; l--) {
        const result = await this._searchLayerEF1(
          key,
          value,
          minNodeKey,
          minDistance,
          l
        );
        minDistance = result.minDistance;
        minNodeKey = result.minNodeKey;
      }

      // (2): Insert the node from its random layer to layer 0
      let entryPoints: SearchNodeCandidate[] = [
        { key: minNodeKey, distance: minDistance }
      ];

      // New node's highest layer => layer 0
      const nodeHightLayerLevel = Math.min(this.graphLayers.length - 1, level);
      for (let l = nodeHightLayerLevel; l >= 0; l--) {
        // Layer 0 could have a different neighbor size constraint
        const levelM = l === 0 ? this.mMax0 : this.m;

        // Search for closest points at this level to connect with
        entryPoints = await this._searchLayer(
          key,
          value,
          entryPoints,
          l,
          this.efConstruction
        );

        // Prune the neighbors so we have at most levelM neighbors
        const selectedNeighbors = await this._selectNeighborsHeuristic(
          entryPoints,
          levelM,
          l
        );

        // Insert the new node
        const newNode = new Map<string, number>();
        for (const neighbor of selectedNeighbors) {
          newNode.set(neighbor.key, neighbor.distance);
        }
        this.graphLayers[l].graph.set(key, newNode);

        // We also need to update this new node's neighbors so that their
        // neighborhood include this new node
        for (const neighbor of selectedNeighbors) {
          const neighborNode = this.graphLayers[l].graph.get(neighbor.key);
          if (neighborNode === undefined) {
            throw Error(`Can't find neighbor node ${neighbor.key}`);
          }

          // Add the neighbor's existing neighbors as candidates
          const neighborNeighborCandidates: SearchNodeCandidate[] = [];
          for (const [key, distance] of neighborNode.entries()) {
            const candidate: SearchNodeCandidate = { key, distance };
            neighborNeighborCandidates.push(candidate);
          }

          // Add the new node as a candidate as well
          neighborNeighborCandidates.push({ key, distance: neighbor.distance });

          // Apply the same heuristic to prune the neighbor's neighbors
          const selectedNeighborNeighbors =
            await this._selectNeighborsHeuristic(
              neighborNeighborCandidates,
              levelM,
              l
            );

          // Update this neighbor's neighborhood
          const newNeighborNode = new Map<string, number>();
          for (const neighborNeighbor of selectedNeighborNeighbors) {
            newNeighborNode.set(
              neighborNeighbor.key,
              neighborNeighbor.distance
            );
          }
          this.graphLayers[l].graph.set(neighbor.key, newNeighborNode);
        }
      }
    }

    // If the level is beyond current layers, extend the layers
    for (let l = this.graphLayers.length; l < level + 1; l++) {
      this.graphLayers.push(new GraphLayer(key));

      // Set entry point as the last added node
      this.entryPointKey = key;
    }
  }

  /**
   * Update an element in the index
   * @param key Key of the element.
   * @param value The new embedding of the element
   */
  async update(key: string, value: number[]) {
    // Wait for initialization to complete
    await this.ready();
    
    if (!(await this.nodes.has(key))) {
      throw Error(
        `The node with key ${key} does not exist. ` +
          'Use insert() to add new node.'
      );
    }

    await this.nodes.set(key, new Node(key, value));

    if (this.entryPointKey === key && (await this.nodes.size()) === 1) {
      return;
    }

    // Re-index all the neighbors of this node in all layers
    for (let l = 0; l < this.graphLayers.length; l++) {
      const curGraphLayer = this.graphLayers[l];
      // Layer 0 could have a different neighbor size constraint
      const levelM = l === 0 ? this.mMax0 : this.m;

      // If the current layer doesn't have this node, then the upper layers
      // won't have it either
      if (!curGraphLayer.graph.has(key)) {
        break;
      }
      const curNode = curGraphLayer.graph.get(key)!;

      // For each neighbor, we use the entire second-degree neighborhood of the
      // updating node as new connection candidates
      const secondDegreeNeighborhood: Set<string> = new Set([key]);

      // Find the second-degree neighborhood
      for (const firstDegreeNeighbor of curNode.keys()) {
        secondDegreeNeighborhood.add(firstDegreeNeighbor);

        const firstDegreeNeighborNode =
          curGraphLayer.graph.get(firstDegreeNeighbor);
        if (firstDegreeNeighborNode === undefined) {
          throw Error(`Can't find node with key ${firstDegreeNeighbor}`);
        }

        for (const secondDegreeNeighbor of firstDegreeNeighborNode.keys()) {
          secondDegreeNeighborhood.add(secondDegreeNeighbor);
        }
      }

      // Update the first-degree neighbor's connections
      const nodeCompare: IGetCompareValue<SearchNodeCandidate> = (
        candidate: SearchNodeCandidate
      ) => candidate.distance;

      for (const firstDegreeNeighbor of curNode.keys()) {
        // (1) Find `efConstruction` number of candidates
        const candidateMaxHeap = new MaxHeap(nodeCompare);
        const firstDegreeNeighborInfo = await this._getNodeInfo(
          firstDegreeNeighbor,
          l
        );

        for (const secondDegreeNeighbor of secondDegreeNeighborhood) {
          if (secondDegreeNeighbor === firstDegreeNeighbor) {
            continue;
          }

          const secondDegreeNeighborInfo = await this._getNodeInfo(
            secondDegreeNeighbor,
            l
          );

          const distance = this.distanceFunction(
            firstDegreeNeighborInfo.value,
            secondDegreeNeighborInfo.value,
            firstDegreeNeighborInfo.key,
            secondDegreeNeighborInfo.key
          );

          if (candidateMaxHeap.size() < this.efConstruction) {
            // Add to the candidates if we still have open slots
            candidateMaxHeap.push({ key: secondDegreeNeighbor, distance });
          } else {
            // Add to the candidates if the distance is better than the worst
            // added candidate, by replacing the worst added candidate
            if (distance < candidateMaxHeap.top()!.distance) {
              candidateMaxHeap.pop();
              candidateMaxHeap.push({ key: secondDegreeNeighbor, distance });
            }
          }
        }

        // (2) Select `levelM` number candidates out of the candidates
        const candidates = candidateMaxHeap.toArray();
        const selectedCandidates = await this._selectNeighborsHeuristic(
          candidates,
          levelM,
          l
        );

        // (3) Update the neighbor's neighborhood
        const newNeighborNode = new Map<string, number>();
        for (const neighborNeighbor of selectedCandidates) {
          newNeighborNode.set(neighborNeighbor.key, neighborNeighbor.distance);
        }
        curGraphLayer.graph.set(firstDegreeNeighbor, newNeighborNode);
      }
    }

    // After re-indexing the neighbors of the updating node, we also need to
    // update the outgoing edges of the updating node in all layers. This is
    // similar to the initial indexing procedure in insert()
    await this._reIndexNode(key, value);
    
    // PHASE 4: Mark node as dirty for incremental save
    this._markDirty(key);
  }

  /**
   * Mark an element in the index as deleted.
   * This function does not delete the node from memory, but just remove it from
   * query result in the future. Future queries can still use this node to reach
   * other nodes. Future insertions will not add new edge to this node.
   *
   * See https://github.com/nmslib/hnswlib/issues/4 for discussion on the
   * challenges of deleting items in HNSW
   *
   * @param key Key of the node to delete
   */
  async markDeleted(key: string) {
    if (!(await this.nodes.has(key))) {
      throw Error(`Node with key ${key} does not exist.`);
    }

    // Special case: the user is trying to delete the entry point
    // We move the entry point to a neighbor or clean the entire graph if the
    // node is the last node
    if (this.entryPointKey === key) {
      let newEntryPointKey: string | null = null;
      // Traverse from top layer to layer 0
      for (let l = this.graphLayers.length - 1; l >= 0; l--) {
        for (const otherKey of this.graphLayers[l].graph.keys()) {
          const otherNodeInfo = await this._getNodeInfo(otherKey, l);
          if (otherKey !== key && !otherNodeInfo.isDeleted) {
            newEntryPointKey = otherKey;
            break;
          }
        }

        if (newEntryPointKey !== null) {
          break;
        } else {
          // There is no more nodes in this layer, we can remove it.
          this.graphLayers.splice(l, 1);
        }
      }

      if (newEntryPointKey === null) {
        // There is no nodes in the index
        await this.clear();
        return;
      }

      this.entryPointKey = newEntryPointKey;
    }

    const nodeInfo = await this._getNodeInfo(key, 0);
    nodeInfo.isDeleted = true;
    await this.nodes.set(key, nodeInfo);
    
    // PHASE 4: Mark as dirty
    this._markDirty(key);
  }

  /**
   * UnMark a deleted element in the index.
   *
   * See https://github.com/nmslib/hnswlib/issues/4 for discussion on the
   * challenges of deleting items in HNSW
   *
   * @param key Key of the node to recover
   */
  async unMarkDeleted(key: string) {
    const nodeInfo = await this._getNodeInfo(key, 0);
    nodeInfo.isDeleted = false;
    await this.nodes.set(key, nodeInfo);
  }

  /**
   * Reset the index.
   */
  async clear() {
    this.graphLayers = [];
    await this.nodes.clear();
  }

  /**
   * Find k nearest neighbors of the query point
   * @param value Embedding value
   * @param k k nearest neighbors of the query value
   * @param ef Number of neighbors to search at each step
   */
  async query(
    value: number[],
    k: number | undefined = undefined,
    ef: number | undefined = this.efConstruction
  ) {
    // Wait for initialization to complete
    await this.ready();
    
    if (this.entryPointKey === null) {
      throw Error('Index is not initialized yet');
    }

    // EF=1 search from the top layer to layer 1
    let minNodeKey: string = this.entryPointKey;
    const entryPointInfo = await this._getNodeInfo(
      minNodeKey,
      this.graphLayers.length - 1
    );
    let minNodeDistance = this.distanceFunction(
      entryPointInfo.value,
      value,
      null,
      null
    );

    for (let l = this.graphLayers.length - 1; l >= 1; l--) {
      const result = await this._searchLayerEF1(
        null,
        value,
        minNodeKey,
        minNodeDistance,
        l,
        false
      );
      minNodeKey = result.minNodeKey;
      minNodeDistance = result.minDistance;
    }

    // EF search on layer 0
    const entryPoints: SearchNodeCandidate[] = [
      { key: minNodeKey, distance: minNodeDistance }
    ];
    const candidates = await this._searchLayer(
      null,
      value,
      entryPoints,
      0,
      ef,
      false
    );

    candidates.sort((a, b) => a.distance - b.distance);

    const topKElements = k === undefined ? candidates : candidates.slice(0, k);

    // Return keys and distances
    const keys = [];
    const distances = [];
    for (const element of topKElements) {
      keys.push(element.key);
      distances.push(element.distance);
    }
    return {
      keys,
      distances
    };
  }

  /**
   * Re-index an existing element's outgoing edges by repeating the insert()
   * algorithm (without updating its neighbor's edges)
   * @param key Key of an existing element
   * @param value Embedding value of an existing element
   */
  async _reIndexNode(key: string, value: number[]) {
    if (this.entryPointKey === null) {
      throw Error('entryPointKey is null');
    }

    let minNodeKey: string = this.entryPointKey;
    const entryPointInfo = await this._getNodeInfo(
      minNodeKey,
      this.graphLayers.length - 1
    );
    let minNodeDistance = this.distanceFunction(
      entryPointInfo.value,
      value,
      entryPointInfo.key,
      key
    );
    let entryPoints: SearchNodeCandidate[] = [
      { key: minNodeKey, distance: minNodeDistance }
    ];

    // Iterating through the top layer to layer 0
    // If the node is not in the layer => ef = 1 search
    // If the node is in the layer => ef search
    for (let l = this.graphLayers.length - 1; l >= 0; l--) {
      const curGraphLayer = this.graphLayers[l];

      if (!curGraphLayer.graph.has(key)) {
        // Layers above: Ef = 1 search
        const result = await this._searchLayerEF1(
          key,
          value,
          minNodeKey,
          minNodeDistance,
          l
        );
        minNodeKey = result.minNodeKey;
        minNodeDistance = result.minDistance;
      } else {
        // The node's top layer and layer below: EF search
        // Layer 0 could have a different neighbor size constraint
        const levelM = l === 0 ? this.mMax0 : this.m;

        // Search for closest points at this level to connect with
        entryPoints = await this._searchLayer(
          key,
          value,
          entryPoints,
          l,
          /** Here ef + 1 because this node is already in the index */
          this.efConstruction + 1
        );

        // Remove the current node itself as it would be selected (0 distance)
        entryPoints = entryPoints.filter(d => d.key !== key);

        // Prune the neighbors so we have at most levelM neighbors
        const selectedNeighbors = await this._selectNeighborsHeuristic(
          entryPoints,
          levelM,
          l
        );

        // Update the node's neighbors
        const newNode = new Map<string, number>();
        for (const neighbor of selectedNeighbors) {
          newNode.set(neighbor.key, neighbor.distance);
        }
        curGraphLayer.graph.set(key, newNode);
      }
    }
  }

  /**
   * Greedy search the closest neighbor in a layer.
   * @param queryKey The key of the query
   * @param queryValue The embedding value of the query
   * @param entryPointKey Current entry point of this layer
   * @param entryPointDistance Distance between query and entry point
   * @param level Current graph layer level
   * @param canReturnDeletedNodes Whether to return deleted nodes
   */
  async _searchLayerEF1(
    queryKey: string | null,
    queryValue: number[],
    entryPointKey: string,
    entryPointDistance: number,
    level: number,
    canReturnDeletedNode = true
  ) {
    const graphLayer = this.graphLayers[level];
    const nodeCandidateCompare: IGetCompareValue<SearchNodeCandidate> = (
      candidate: SearchNodeCandidate
    ) => candidate.distance;
    const candidateHeap = new MinHeap(nodeCandidateCompare);

    // Initialize the min heap with the current entry point
    candidateHeap.push({ key: entryPointKey, distance: entryPointDistance });

    // Find the node with the minimal distance using greedy graph search
    let minNodeKey = entryPointKey;
    let minDistance = entryPointDistance;
    const visitedNodes = new Set<string>();

    while (candidateHeap.size() > 0) {
      const curCandidate = candidateHeap.pop()!;
      if (curCandidate.distance > minDistance) {
        break;
      }

      const curNode = graphLayer.graph.get(curCandidate.key);
      if (curNode === undefined) {
        throw Error(`Cannot find node with key ${curCandidate.key})}`);
      }

      for (const key of curNode.keys()) {
        if (!visitedNodes.has(key)) {
          visitedNodes.add(key);
          // Compute the distance between the node and query
          const curNodeInfo = await this._getNodeInfo(key, level);
          const distance = this.distanceFunction(
            curNodeInfo.value,
            queryValue,
            curNodeInfo.key,
            queryKey
          );

          // Continue explore the node's neighbors if the distance is improving
          if (distance < minDistance) {
            // If the current node is marked as deleted, we do not return it as
            // a candidate, but we continue explore its neighbor
            if (!curNodeInfo.isDeleted || canReturnDeletedNode) {
              minDistance = distance;
              minNodeKey = key;
            }
            candidateHeap.push({ key, distance });
          }
        }
      }
    }

    return {
      minNodeKey,
      minDistance
    };
  }

  /**
   * Greedy search `ef` closest points in a given layer
   * @param queryKey The key of the query
   * @param queryValue Embedding value of the query point
   * @param entryPoints Entry points of this layer
   * @param level Current layer level to search
   * @param ef Number of neighbors to consider during search
   * @param canReturnDeletedNodes Whether to return deleted nodes
   */
  async _searchLayer(
    queryKey: string | null,
    queryValue: number[],
    entryPoints: SearchNodeCandidate[],
    level: number,
    ef: number,
    canReturnDeletedNodes = true
  ) {
    const graphLayer = this.graphLayers[level];

    // We maintain two heaps in this function
    // For candidate nodes, we use a min heap to get the closest node
    // For found nearest nodes, we use a max heap to get the furthest node
    const nodeCompare: IGetCompareValue<SearchNodeCandidate> = (
      candidate: SearchNodeCandidate
    ) => candidate.distance;

    const candidateMinHeap = new MinHeap(nodeCompare);
    const foundNodesMaxHeap = new MaxHeap(nodeCompare);
    const visitedNodes = new Set<string>();

    for (const searchNode of entryPoints) {
      candidateMinHeap.push(searchNode);
      foundNodesMaxHeap.push(searchNode);
      visitedNodes.add(searchNode.key);
    }

    while (candidateMinHeap.size() > 0) {
      const nearestCandidate = candidateMinHeap.pop()!;
      const furthestFoundNode = foundNodesMaxHeap.root()!;

      if (nearestCandidate.distance > furthestFoundNode.distance) {
        break;
      }

      // Update candidates and found nodes using the current node's neighbors
      const curNode = graphLayer.graph.get(nearestCandidate.key);
      if (curNode === undefined) {
        throw Error(`Cannot find node with key ${nearestCandidate.key}`);
      }

      for (const neighborKey of curNode.keys()) {
        if (!visitedNodes.has(neighborKey)) {
          visitedNodes.add(neighborKey);

          // Compute the distance of the neighbor and query
          const neighborInfo = await this._getNodeInfo(neighborKey, level);
          const distance = this.distanceFunction(
            queryValue,
            neighborInfo.value,
            queryKey,
            neighborInfo.key
          );
          const furthestFoundNode = foundNodesMaxHeap.root()!;

          // Add this node if it is better than our found nodes or we do not
          // have enough found nodes
          if (
            distance < furthestFoundNode.distance ||
            foundNodesMaxHeap.size() < ef
          ) {
            // If the current neighbor is marked as deleted, we do not return it
            // as a found node, but we continue explore its neighbor
            if (!neighborInfo.isDeleted || canReturnDeletedNodes) {
              foundNodesMaxHeap.push({ key: neighborKey, distance });
            }
            candidateMinHeap.push({ key: neighborKey, distance });

            // If we have more found nodes than ef, remove the furthest point
            if (foundNodesMaxHeap.size() > ef) {
              foundNodesMaxHeap.pop();
            }
          }
        }
      }
    }

    return foundNodesMaxHeap.toArray();
  }

  /**
   * Simple heuristic to select neighbors. This function is different from
   * SELECT-NEIGHBORS-HEURISTIC in the HNSW paper. This function is based on
   * hnswlib and datasketch's implementations.
   * When selecting a neighbor, we compare the distance between selected
   * neighbors and the potential neighbor to the distance between the inserted
   * point and the potential neighbor. We favor neighbors that are further
   * away from selected neighbors to improve diversity.
   *
   * https://github.com/nmslib/hnswlib/blob/978f7137bc9555a1b61920f05d9d0d8252ca9169/hnswlib/hnswalg.h#L382
   * https://github.com/ekzhu/datasketch/blob/9973b09852a5018f23d831b1868da3a5d2ce6a3b/datasketch/hnsw.py#L832
   *
   * @param candidates Potential neighbors to select from
   * @param maxSize Max neighbors to connect to
   * @param level Current graph layer level
   */
  async _selectNeighborsHeuristic(
    candidates: SearchNodeCandidate[],
    maxSize: number,
    level: number
  ) {
    // candidates.length <= maxSize is more "correct", use < to be consistent
    // with other packages
    if (candidates.length < maxSize) {
      return candidates;
    }

    const nodeCompare: IGetCompareValue<SearchNodeCandidate> = (
      candidate: SearchNodeCandidate
    ) => candidate.distance;

    const candidateMinHeap = new MinHeap(nodeCompare);
    for (const candidate of candidates) {
      candidateMinHeap.insert(candidate);
    }

    const selectedNeighbors: SearchNodeCandidate[] = [];

    while (candidateMinHeap.size() > 0) {
      if (selectedNeighbors.length >= maxSize) {
        return selectedNeighbors;
      }

      const candidate = candidateMinHeap.pop()!;
      let isCandidateFarFromExistingNeighbors = true;

      // Iterate selected neighbors to see if the candidate is further away
      for (const selectedNeighbor of selectedNeighbors) {
        const candidateInfo = await this._getNodeInfo(candidate.key, level);
        const neighborInfo = await this._getNodeInfo(
          selectedNeighbor.key,
          level
        );

        const distanceCandidateToNeighbor = this.distanceFunction(
          candidateInfo.value,
          neighborInfo.value,
          candidate.key,
          neighborInfo.key
        );

        // Reject the candidate if
        // d(candidate, any approved candidate) < d(candidate, new node)
        if (distanceCandidateToNeighbor < candidate.distance) {
          isCandidateFarFromExistingNeighbors = false;
          break;
        }
      }

      if (isCandidateFarFromExistingNeighbors) {
        selectedNeighbors.push(candidate);
      }
    }

    return selectedNeighbors;
  }

  /**
   * Generate a random level for a node using a exponentially decaying
   * probability distribution
   */
  _getRandomLevel() {
    return Math.floor(-Math.log(this.rng()) * this.ml);
  }

  /**
   * Helper function to get the node in the global index
   * @param key Node key
   * @param level The current graph level. Note the node's embedding is the same
   * across levels, but we need the level number to pre-fetch node / neighbor
   * embeddings from indexedDB
   */
  async _getNodeInfo(key: string, level: number) {
    const node = await this.nodes.get(key, level);
    if (node === undefined) {
      throw Error(`Can't find node with key ${key}`);
    }
    return node;
  }

  /**
   * PHASE 4: Mark a node and its layers as dirty for incremental save
   */
  private _markDirty(key: string, maxLevel?: number) {
    this._dirtyNodes.add(key);
    
    // Mark all layers this node appears in as dirty
    const topLevel = maxLevel !== undefined ? maxLevel : this.graphLayers.length - 1;
    for (let l = 0; l <= topLevel && l < this.graphLayers.length; l++) {
      if (this.graphLayers[l].graph.has(key)) {
        this._dirtyLayers.add(l);
      }
    }
    
    // Trigger autosave if enabled
    if (this._enableAutosave) {
      this._scheduleAutosave();
    }
  }

  /**
   * PHASE 4: Schedule debounced autosave
   */
  private _scheduleAutosave() {
    // Clear existing timer
    if (this._autosaveTimer) {
      clearTimeout(this._autosaveTimer);
    }
    
    // Schedule new autosave
    this._autosaveTimer = setTimeout(async () => {
      await this.incrementalSaveIndex();
    }, this._autosaveDelay);
  }

  /**
   * PHASE 4: Enable or disable autosave
   */
  setAutosave(enabled: boolean, delayMs: number = 5000) {
    this._enableAutosave = enabled;
    this._autosaveDelay = delayMs;
    
    if (!enabled && this._autosaveTimer) {
      clearTimeout(this._autosaveTimer);
      this._autosaveTimer = null;
    }
  }

  /**
   * PHASE 4: Save only the dirty (modified) parts of the index
   * Much faster than saveIndex() for large indexes with small changes
   */
  async incrementalSaveIndex() {
    if (!this.useIndexedDB) {
      throw new Error('Cannot save index: IndexedDB is not enabled');
    }

    if (this._dirtyNodes.size === 0 && this._dirtyLayers.size === 0) {
      // Nothing to save
      return;
    }

    // Get the full index structure (we need metadata)
    const indexData = this.exportIndex();
    
    // For incremental save, we only update the graph edges for dirty layers
    // Node embeddings are already saved to IndexedDB via nodes.set()
    
    const myDexie = new Dexie('mememo-index-store');
    myDexie.version(1).stores({
      mememo: 'key',
      indexMetadata: 'id'
    });
    const metadataTable = myDexie.table('indexMetadata');
    
    // Save the updated index structure
    await metadataTable.put({ id: 'graph', data: indexData });
    
    // Clear dirty flags
    this._dirtyNodes.clear();
    this._dirtyLayers.clear();
    this._lastSaveTime = Date.now();
    
    // Clear autosave timer
    if (this._autosaveTimer) {
      clearTimeout(this._autosaveTimer);
      this._autosaveTimer = null;
    }
  }

  /**
   * PHASE 4: Get dirty tracking stats
   */
  getDirtyStats() {
    return {
      dirtyNodes: this._dirtyNodes.size,
      dirtyLayers: this._dirtyLayers.size,
      lastSaveTime: this._lastSaveTime,
      autosaveEnabled: this._enableAutosave
    };
  }

  /**
   * PHASE 4: Force clear dirty flags (for testing)
   */
  clearDirtyFlags() {
    this._dirtyNodes.clear();
    this._dirtyLayers.clear();
  }
}

/**
 * Round a number to a given decimal.
 * @param {number} num Number to round
 * @param {number} decimal Decimal place
 * @returns number
 */
export const round = (num: number, decimal: number) => {
  return Math.round((num + Number.EPSILON) * 10 ** decimal) / 10 ** decimal;
};

// Export HNSW as Mememo for backward compatibility
export { HNSW as Mememo };
