/**
 * Worker task handlers
 * These functions run in the worker context and handle specific task types
 */

import { pipeline, FeatureExtractionPipeline, SummarizationPipeline } from '@huggingface/transformers';
import { EmbedTaskPayload, SummarizeTaskPayload, ProgressCallback } from './worker-types';

// Model cache type (shared across handlers)
type ModelCache = Map<string, FeatureExtractionPipeline | SummarizationPipeline>;

/**
 * Load and cache embedding model
 */
async function getEmbeddingModel(
  modelName: string,
  cache: ModelCache,
  progressCallback?: ProgressCallback
): Promise<FeatureExtractionPipeline> {
  if (cache.has(modelName)) {
    progressCallback?.(0.1, 'model_cached');
    return cache.get(modelName) as FeatureExtractionPipeline;
  }
  
  progressCallback?.(0.05, 'loading_model');
  const model = await pipeline('feature-extraction', modelName, {
    progress_callback: (progressInfo: any) => {
      const progress = typeof progressInfo === 'number' ? progressInfo : progressInfo.progress || 0;
      progressCallback?.(0.05 + progress * 0.35, 'loading_model');
    },
  }) as FeatureExtractionPipeline;
  
  // Cache model (with size limit - simple FIFO)
  if (cache.size >= 2) {
    // Remove oldest (first key)
    const firstKey = cache.keys().next().value;
    if (firstKey) {
      cache.delete(firstKey);
    }
  }
  cache.set(modelName, model);
  
  progressCallback?.(0.4, 'model_loaded');
  return model;
}

/**
 * Load and cache summarization model
 */
async function getSummarizationModel(
  modelName: string,
  cache: ModelCache,
  progressCallback?: ProgressCallback
): Promise<SummarizationPipeline> {
  if (cache.has(modelName)) {
    progressCallback?.(0.1, 'model_cached');
    return cache.get(modelName) as SummarizationPipeline;
  }
  
  progressCallback?.(0.05, 'loading_model');
  const model = await pipeline('summarization', modelName, {
    progress_callback: (progressInfo: any) => {
      const progress = typeof progressInfo === 'number' ? progressInfo : progressInfo.progress || 0;
      progressCallback?.(0.05 + progress * 0.35, 'loading_model');
    },
  }) as SummarizationPipeline;
  
  // Cache model (with size limit - simple FIFO)
  if (cache.size >= 2) {
    // Remove oldest (first key)
    const firstKey = cache.keys().next().value;
    if (firstKey) {
      cache.delete(firstKey);
    }
  }
  cache.set(modelName, model);
  
  progressCallback?.(0.4, 'model_loaded');
  return model;
}

/**
 * Handle embedding task
 */
export async function handleEmbedTask(
  payload: EmbedTaskPayload,
  modelCache: ModelCache,
  progressCallback?: ProgressCallback
): Promise<number[]> {
  const modelName = payload.model || 'Xenova/all-MiniLM-L6-v2';
  
  progressCallback?.(0.4, 'loading_model');
  const model = await getEmbeddingModel(modelName, modelCache, progressCallback);
  
  progressCallback?.(0.7, 'embedding');
  const output = await model(payload.text, {
    pooling: 'mean',
    normalize: true,
  });
  
  progressCallback?.(0.95, 'processing');
  const result = Array.from(output.data);
  
  progressCallback?.(1.0, 'complete');
  return result;
}

/**
 * Handle summarization task
 */
export async function handleSummarizeTask(
  payload: SummarizeTaskPayload,
  modelCache: ModelCache,
  progressCallback?: ProgressCallback
): Promise<string> {
  const modelName = payload.model || 'Xenova/distilbart-cnn-6-6';
  
  progressCallback?.(0.1, 'loading_model');
  const model = await getSummarizationModel(modelName, modelCache, progressCallback);
  
  progressCallback?.(0.5, 'summarizing');
  const modelOptions: any = {
    max_new_tokens: payload.maxNewTokens || 100,
  };
  if (payload.minLength !== undefined) {
    modelOptions.min_length = payload.minLength;
  }
  if (payload.maxLength !== undefined) {
    modelOptions.max_length = payload.maxLength;
  }
  const output = await model(payload.text, modelOptions);
  
  progressCallback?.(0.9, 'processing');
  
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
  
  progressCallback?.(1.0, 'complete');
  return summary;
}
