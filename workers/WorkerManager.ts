/**
 * Worker Manager
 * Singleton class for managing worker lifecycle and task execution
 * Runs in main thread
 */

import { WorkerRequest, WorkerResponse, WorkerConfig, WorkerTaskType } from './worker-types';

interface PendingTask {
  request: WorkerRequest;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  progressCallback?: (progress: number) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
}

export class WorkerManager {
  private static instance: WorkerManager;
  private worker: Worker | null = null;
  private pendingTasks = new Map<string, PendingTask>();
  private config: Required<WorkerConfig>;
  
  private constructor(config?: WorkerConfig) {
    this.config = {
      maxConcurrentTasks: config?.maxConcurrentTasks ?? 1,
      taskTimeout: config?.taskTimeout ?? 5 * 60 * 1000, // 5 minutes
      enableModelCache: config?.enableModelCache ?? true,
      modelCacheSize: config?.modelCacheSize ?? 2,
    };
  }
  
  /**
   * Get singleton instance
   */
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
        const task = this.pendingTasks.get(id);
        if (task) {
          this.pendingTasks.delete(id);
          task.reject(new Error(`Task ${id} timed out after ${this.config.taskTimeout}ms`));
        }
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
      if (this.worker) {
        this.worker.postMessage(fullRequest);
      } else {
        clearTimeout(timeoutId);
        this.pendingTasks.delete(id);
        reject(new Error('Failed to initialize worker'));
      }
    });
  }
  
  /**
   * Initialize worker if needed
   */
  private ensureWorker(): void {
    if (this.worker) return;
    
    try {
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
    } catch (error) {
      console.error('Failed to create worker:', error);
      this.worker = null;
      throw error;
    }
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
      const error = new Error(response.error.message);
      if (response.error.code) {
        (error as any).code = response.error.code;
      }
      if (response.error.stack) {
        error.stack = response.error.stack;
      }
      pendingTask.reject(error);
    }
  }
  
  /**
   * Handle worker errors
   */
  private handleWorkerError(error: ErrorEvent): void {
    // Reject all pending tasks
    for (const [id, task] of this.pendingTasks.entries()) {
      if (task.timeoutId) {
        clearTimeout(task.timeoutId);
      }
      task.reject(new Error(`Worker error: ${error.message || 'Unknown error'}`));
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
      if (task.timeoutId) {
        clearTimeout(task.timeoutId);
      }
      task.reject(new Error('Worker terminated'));
    }
    this.pendingTasks.clear();
  }
  
  /**
   * Get worker URL (handles build/dev differences)
   * 
   * Strategy:
   * 1. Try to resolve relative to import.meta.url (ES modules)
   * 2. Try multiple relative paths to handle different bundling scenarios
   * 3. Fallback to document-based resolution
   * 
   * This works because:
   * - Rollup bundles worker.ts → dist/workers/worker.js with all dependencies
   * - The bundled worker.js is a standalone file that can be loaded
   * - Path resolution works relative to the main bundle location
   */
  private getWorkerUrl(): string {
    // Skip import.meta.url resolution in test environments (Node.js/Jest)
    // In production ES module builds, this will be handled by the bundler
    const isTestEnv = typeof process !== 'undefined' && 
                     (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined);
    
    if (!isTestEnv) {
      // Try to use import.meta.url if available (ES modules)
      // This code will only execute in browser/production environments
      // where import.meta is available and TypeScript won't complain
      try {
        // Use a function to access import.meta to avoid TypeScript parsing issues
        // In ES module contexts, this will work at runtime
        const getImportMetaUrl = () => {
          // This will be evaluated at runtime in ES module contexts
          // @ts-ignore - import.meta is available in ES modules but TypeScript may not recognize it
          return typeof (0, eval)('import.meta') !== 'undefined' 
            ? (0, eval)('import.meta.url') 
            : undefined;
        };
        
        const importMetaUrl = getImportMetaUrl();
        
        if (importMetaUrl) {
          // Try different relative paths based on where the code might be bundled
          // From dist/embeddings/ or dist/ → dist/workers/worker.js
          const paths = [
            '../workers/worker.js',  // From dist/embeddings/ or dist/some-folder/
            '../../workers/worker.js', // From nested folders
            './workers/worker.js',   // From dist/ root
          ];
          
          for (const path of paths) {
            try {
              const url = new URL(path, importMetaUrl);
              // Return first valid URL (we can't check if file exists, so try them all)
              return url.href;
            } catch {
              continue;
            }
          }
          
          // Fallback to same directory (for development/testing)
          return new URL('./worker.js', importMetaUrl).href;
        }
      } catch {
        // If import.meta is not available or resolution fails, fall through to document-based
      }
    }
    
    // Fallback: relative path (works when library is bundled by consumer)
    // This assumes the worker.js is in a known location relative to the main bundle
    if (typeof document !== 'undefined') {
      const script = document.querySelector('script[src]');
      const baseUrl = (document.currentScript as HTMLScriptElement)?.src || 
                      (script && 'src' in script ? (script as HTMLScriptElement).src : null) ||
                      window.location.href;
      try {
        return new URL('./workers/worker.js', baseUrl).href;
      } catch {
        // Last resort: assume worker is in same directory
        return './worker.js';
      }
    }
    
    // Final fallback
    return './worker.js';
  }
  
  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Check if worker is available
   */
  isAvailable(): boolean {
    return typeof Worker !== 'undefined' && this.worker !== null;
  }
  
  /**
   * Get number of pending tasks
   */
  getPendingTaskCount(): number {
    return this.pendingTasks.size;
  }
  
  /**
   * Cleanup (call when done)
   */
  destroy(): void {
    this.terminateWorker();
    WorkerManager.instance = null as any; // Reset singleton
  }
}
