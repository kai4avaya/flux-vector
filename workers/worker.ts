/**
 * Main worker script
 * Runs in worker context and handles all task types
 */

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

/**
 * Create a timeout promise that rejects after specified milliseconds
 */
function createTimeout(requestId: string, ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Task ${requestId} timed out after ${ms}ms`));
    }, ms);
  });
}

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
    
    // Execute task with timeout (5 minutes default)
    const timeoutMs = 5 * 60 * 1000; // 5 minutes
    const result = await Promise.race([
      handler(request.payload, modelCache, progressCallback),
      createTimeout(request.id, timeoutMs),
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

// Handle worker errors
self.onerror = (error) => {
  console.error('Worker error:', error);
};

// Handle unhandled promise rejections
self.onunhandledrejection = (event) => {
  console.error('Unhandled promise rejection in worker:', event.reason);
};
