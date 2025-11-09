/**
 * Shared types between main thread and workers
 * Ensures type safety across the thread boundary
 */

// Task types that workers can handle
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

// Progress callback type
export type ProgressCallback = (progress: number, stage?: string) => void;
