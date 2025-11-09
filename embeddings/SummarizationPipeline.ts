import {
  pipeline,
  SummarizationPipeline as TransformersSummarizationPipeline,
  ProgressCallback,
} from "@huggingface/transformers";
import { WorkerManager, WorkerTaskType } from "../workers";
import type { SummarizeTaskPayload } from "../workers/worker-types";

/**
 * Options for summarization
 */
export interface SummarizationOptions {
  maxNewTokens?: number;
  minLength?: number;
  maxLength?: number;
  model?: string; // Custom model override
}

/**
 * Interface for custom summarization engines.
 * Implement this interface to use your own summarization model.
 */
export interface ISummarizationEngine {
  /**
   * Generate a summary for given text.
   * @param text The text to summarize.
   * @param options Optional summarization options.
   * @param progressCallback Optional callback for tracking summarization progress.
   * @returns The summary text.
   */
  summarize(
    text: string,
    options?: SummarizationOptions,
    progressCallback?: (progress: number) => void
  ): Promise<string>;
}

/**
 * This class uses the singleton pattern to ensure that only one instance
 * of the summarization pipeline is ever created (for main thread fallback).
 */
class SummarizationPipeline {
  static task = "summarization" as const;
  static model: string = "Xenova/distilbart-cnn-6-6"; // Fastest default model
  static instance: TransformersSummarizationPipeline | null = null;

  /**
   * Get the singleton instance of the summarization pipeline.
   * @param progress_callback A function to track model loading progress.
   */
  static async getInstance(
    progress_callback?: ProgressCallback
  ): Promise<TransformersSummarizationPipeline> {
    if (this.instance === null) {
      this.instance = await pipeline(
        this.task,
        this.model,
        { progress_callback }
      ) as TransformersSummarizationPipeline;
    }
    return this.instance;
  }
}

/**
 * Default summarization engine using HuggingFace transformers.
 * Uses Xenova/distilbart-cnn-6-6 model by default (fastest option).
 * Supports running in worker or main thread (with fallback).
 */
export class DefaultSummarizationEngine implements ISummarizationEngine {
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
   * Generate a summary for given text.
   * @param text The text to summarize.
   * @param options Optional summarization options.
   * @param progressCallback Optional callback for tracking summarization progress.
   * @returns The summary text.
   */
  async summarize(
    text: string,
    options?: SummarizationOptions,
    progressCallback?: (progress: number) => void
  ): Promise<string> {
    // Try worker mode first if enabled
    if (this.useWorker && this.workerManager?.isAvailable()) {
      try {
        return await this.summarizeInWorker(text, options, progressCallback);
      } catch (error) {
        console.warn('Worker summarization failed, falling back to main thread:', error);
        // Fall through to main thread fallback
      }
    }

    // Fallback to main thread
    return await this.summarizeInMainThread(text, options, progressCallback);
  }

  /**
   * Summarize using worker (non-blocking)
   */
  private async summarizeInWorker(
    text: string,
    options?: SummarizationOptions,
    progressCallback?: (progress: number) => void
  ): Promise<string> {
    if (!this.workerManager) {
      throw new Error('Worker manager not available');
    }

    const payload: SummarizeTaskPayload = {
      text,
      model: options?.model,
      maxNewTokens: options?.maxNewTokens,
      minLength: options?.minLength,
      maxLength: options?.maxLength,
    };

    return await this.workerManager.execute<string>(
      {
        task: WorkerTaskType.SUMMARIZE,
        payload,
      },
      progressCallback
    );
  }

  /**
   * Summarize in main thread (fallback)
   */
  private async summarizeInMainThread(
    text: string,
    options?: SummarizationOptions,
    progressCallback?: (progress: number) => void
  ): Promise<string> {
    progressCallback?.(0.1);

    // Get the model instance (this may trigger model loading on first call)
    const model = await SummarizationPipeline.getInstance(this.modelLoadCallback);
    progressCallback?.(0.4);

    // Generate summary
    progressCallback?.(0.5);
    const modelOptions: any = {
      max_new_tokens: options?.maxNewTokens || 100,
    };
    if (options?.minLength !== undefined) {
      modelOptions.min_length = options.minLength;
    }
    if (options?.maxLength !== undefined) {
      modelOptions.max_length = options.maxLength;
    }
    const output = await model(text, modelOptions);

    progressCallback?.(0.9);

    // Handle different output formats
    let summary: string;
    if (Array.isArray(output)) {
      const firstOutput = output[0] as any;
      summary = firstOutput?.summary_text || '';
    } else if (typeof output === 'object' && output !== null) {
      const outputObj = output as any;
      summary = outputObj.summary_text || '';
    } else {
      throw new Error('Unexpected output format from summarization model');
    }

    if (!summary || summary.trim().length === 0) {
      throw new Error('Failed to generate summary: empty result');
    }

    progressCallback?.(1.0);
    return summary;
  }
}

/**
 * Singleton helper function for backward compatibility.
 * Uses the default summarization engine.
 */
export async function summarize(
  text: string,
  options?: SummarizationOptions
): Promise<string> {
  const engine = new DefaultSummarizationEngine();
  return engine.summarize(text, options);
}
