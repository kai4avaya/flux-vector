import {
  pipeline,
  FeatureExtractionPipeline,
  Tensor,
  FeatureExtractionPipelineOptions,
  ProgressCallback,
} from "@huggingface/transformers";
import { WorkerManager, WorkerTaskType } from "../workers";
import type { EmbedTaskPayload } from "../workers/worker-types";

/**
 * Interface for custom embedding engines.
 * Implement this interface to use your own embedding model.
 */
export interface IEmbeddingEngine {
  /**
   * Generate an embedding for a given text.
   * @param text The text to embed.
   * @param progressCallback Optional callback for tracking embedding progress.
   * @returns The embedding as a number array.
   */
  embed(text: string, progressCallback?: (progress: number) => void): Promise<number[]>;
}

/**
 * This class uses the singleton pattern to ensure that only one instance
 * of the embedding pipeline is ever created.
 */
class EmbeddingPipeline {
  static task = "feature-extraction" as const;
  static model: string = "Xenova/all-MiniLM-L6-v2";
  static instance: FeatureExtractionPipeline | null = null;

  /**
   * Get the singleton instance of the embedding pipeline.
   * @param progress_callback A function to track model loading progress.
   */
  static async getInstance(
    progress_callback?: ProgressCallback
  ): Promise<any> {
    if (this.instance === null) {
      this.instance = await pipeline(this.task, this.model, { progress_callback }) as any;
    }
    return this.instance;
  }
}

/**
 * Default embedding engine using HuggingFace transformers.
 * Uses Xenova/all-MiniLM-L6-v2 model which produces 384-dimension embeddings.
 * Supports running in worker or main thread (with fallback).
 */
export class DefaultEmbeddingEngine implements IEmbeddingEngine {
  private modelLoadCallback?: ProgressCallback;
  private useWorker: boolean;
  private workerManager?: WorkerManager;

  constructor(
    modelLoadCallback?: ProgressCallback,
    useWorker: boolean = true
  ) {
    this.modelLoadCallback = modelLoadCallback;
    this.useWorker = useWorker;
    
    if (useWorker) {
      try {
        this.workerManager = WorkerManager.getInstance();
      } catch (error) {
        console.warn('Failed to initialize worker manager, falling back to main thread:', error);
        this.useWorker = false;
      }
    }
  }
  
  /**
   * Helper function to embed a single piece of text.
   * @param text The text to embed.
   * @param progressCallback Optional callback for tracking embedding progress.
   * @returns The 384-dimension embedding.
   */
  async embed(text: string, progressCallback?: (progress: number) => void): Promise<number[]> {
    // Try worker mode first if enabled
    if (this.useWorker && this.workerManager?.isAvailable()) {
      try {
        return await this.embedInWorker(text, progressCallback);
      } catch (error) {
        console.warn('Worker embedding failed, falling back to main thread:', error);
        // Fall through to main thread fallback
      }
    }

    // Fallback to main thread
    return await this.embedInMainThread(text, progressCallback);
  }

  /**
   * Embed using worker (non-blocking)
   */
  private async embedInWorker(
    text: string,
    progressCallback?: (progress: number) => void
  ): Promise<number[]> {
    if (!this.workerManager) {
      throw new Error('Worker manager not available');
    }

    const payload: EmbedTaskPayload = {
      text,
    };

    return await this.workerManager.execute<number[]>(
      {
        task: WorkerTaskType.EMBED,
        payload,
      },
      progressCallback
    );
  }

  /**
   * Embed in main thread (fallback)
   */
  private async embedInMainThread(
    text: string,
    progressCallback?: (progress: number) => void
  ): Promise<number[]> {
    // Report start
    progressCallback?.(0);
    
    // Get the model instance (this may trigger model loading on first call)
    const extractor = await EmbeddingPipeline.getInstance(this.modelLoadCallback);
    progressCallback?.(0.3); // 30% - model loaded

    // Compute the embedding
    const output: Tensor = await extractor(text, {
      pooling: "mean",
      normalize: true,
    } as FeatureExtractionPipelineOptions);
    progressCallback?.(0.9); // 90% - embedding computed

    // Extract the embedding data and convert to a standard array
    const result = Array.from(output.data);
    progressCallback?.(1.0); // 100% - complete
    
    return result;
  }
}

/**
 * Singleton helper function for backward compatibility.
 * Uses the default embedding engine.
 */
export async function embed(text: string): Promise<number[]> {
  const engine = new DefaultEmbeddingEngine();
  return engine.embed(text);
}
