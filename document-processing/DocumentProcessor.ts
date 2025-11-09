import { DocumentExtractionManager, IDocumentExtractor, ExtractorConfig } from './DocumentExtractor';
import { TextChunkingManager, ITextChunker, ChunkingConfig } from './TextChunker';

/**
 * Configuration for the document processor
 */
export interface DocumentProcessorConfig {
  /** Extractor configuration */
  extractorConfig?: ExtractorConfig;
  
  /** Chunking configuration */
  chunkingConfig?: ChunkingConfig;
  
  /** Default chunking strategy to use */
  defaultChunkingStrategy?: string;
  
  /** Custom document extractors */
  customExtractors?: IDocumentExtractor[];
  
  /** Custom text chunkers */
  customChunkers?: Array<{ name: string; chunker: ITextChunker }>;
}

/**
 * Document metadata
 */
export interface DocumentMetadata {
  filename?: string;
  mimeType: string;
  size?: number;
  extractedAt: Date;
  chunkingStrategy?: string;
  totalChunks?: number;
}

/**
 * Processed document chunk
 */
export interface ProcessedChunk {
  text: string;
  index: number;
  metadata: DocumentMetadata;
}

/**
 * Document Processor
 * Orchestrates document extraction and text chunking
 */
export class DocumentProcessor {
  private extractionManager: DocumentExtractionManager;
  private chunkingManager: TextChunkingManager;
  private config: DocumentProcessorConfig;

  constructor(config: DocumentProcessorConfig = {}) {
    this.config = config;
    
    // Initialize extraction manager
    this.extractionManager = new DocumentExtractionManager();
    
    // Register custom extractors
    if (config.customExtractors) {
      config.customExtractors.forEach(extractor => {
        this.extractionManager.registerExtractor(extractor);
      });
    }
    
    // Initialize chunking manager
    this.chunkingManager = new TextChunkingManager();
    
    // Register custom chunkers
    if (config.customChunkers) {
      config.customChunkers.forEach(({ name, chunker }) => {
        this.chunkingManager.registerChunker(name, chunker);
      });
    }
  }

  /**
   * Process a document: extract text and chunk it.
   * @param file File to process
   * @param mimeType MIME type of the file
   * @param options Processing options
   */
  async processDocument(
    file: File | Buffer | ArrayBuffer,
    mimeType: string,
    options?: {
      filename?: string;
      chunkingStrategy?: string;
      chunkingConfig?: ChunkingConfig;
      skipChunking?: boolean;
    }
  ): Promise<ProcessedChunk[]> {
    const startTime = Date.now();
    
    // Step 1: Extract text from document
    // Extracting text from document
    const extractedText = await this.extractionManager.extractText(
      file,
      mimeType,
      this.config.extractorConfig
    );
    
    // Text extraction completed
    
    // If chunking is skipped, return single chunk
    if (options?.skipChunking) {
      const metadata: DocumentMetadata = {
        filename: options.filename,
        mimeType,
        size: extractedText.length,
        extractedAt: new Date(),
        totalChunks: 1,
      };
      
      return [{
        text: extractedText,
        index: 0,
        metadata,
      }];
    }
    
    // Step 2: Chunk the text
    const chunkingStrategy = options?.chunkingStrategy || 
                            this.config.defaultChunkingStrategy || 
                            'default';
    
    // Chunking text
    const chunks = this.chunkingManager.chunk(
      extractedText,
      chunkingStrategy,
      options?.chunkingConfig || this.config.chunkingConfig
    );
    
    // Chunking completed
    
    // Step 3: Create processed chunks with metadata
    const metadata: DocumentMetadata = {
      filename: options?.filename,
      mimeType,
      size: extractedText.length,
      extractedAt: new Date(),
      chunkingStrategy,
      totalChunks: chunks.length,
    };
    
    return chunks.map((text, index) => ({
      text,
      index,
      metadata: { ...metadata },
    }));
  }

  /**
   * Process multiple documents in batch.
   */
  async processBatch(
    documents: Array<{
      file: File | Buffer | ArrayBuffer;
      mimeType: string;
      filename?: string;
    }>,
    options?: {
      chunkingStrategy?: string;
      chunkingConfig?: ChunkingConfig;
      skipChunking?: boolean;
    }
  ): Promise<ProcessedChunk[]> {
    const allChunks: ProcessedChunk[] = [];
    
    for (const doc of documents) {
      const chunks = await this.processDocument(
        doc.file,
        doc.mimeType,
        {
          filename: doc.filename,
          ...options,
        }
      );
      allChunks.push(...chunks);
    }
    
    return allChunks;
  }

  /**
   * Get supported document types.
   */
  getSupportedTypes(): string[] {
    return this.extractionManager.getSupportedMimeTypes();
  }

  /**
   * Get available chunking strategies.
   */
  getChunkingStrategies(): string[] {
    return this.chunkingManager.getAvailableStrategies();
  }

  /**
   * Register a custom document extractor.
   */
  registerExtractor(extractor: IDocumentExtractor): void {
    this.extractionManager.registerExtractor(extractor);
  }

  /**
   * Register a custom text chunker.
   */
  registerChunker(name: string, chunker: ITextChunker): void {
    this.chunkingManager.registerChunker(name, chunker);
  }
}
