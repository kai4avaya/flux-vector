/**
 * Interface for text chunking strategies.
 */
export interface ITextChunker {
  /**
   * Split text into chunks.
   * @param text The text to chunk
   * @param options Optional chunking options
   * @returns Array of text chunks
   */
  chunk(text: string, options?: any): string[];
}

/**
 * Configuration for text chunking
 */
export interface ChunkingConfig {
  /** Maximum size of each chunk in characters */
  chunkSize?: number;
  
  /** Number of characters to overlap between chunks */
  chunkOverlap?: number;
  
  /** Alias for chunkOverlap */
  overlap?: number;
  
  /** Separators to use for splitting (in order of priority) */
  separators?: string[];
  
  /** Whether to keep separator in the chunks */
  keepSeparator?: boolean;
}

/**
 * Default chunking configuration
 */
export const DEFAULT_CHUNKING_CONFIG: Required<Omit<ChunkingConfig, 'overlap'>> = {
  chunkSize: 1000,
  chunkOverlap: 200,
  separators: ['\n\n', '\n', '. ', '! ', '? ', ', ', ' '],
  keepSeparator: false,
};

/**
 * Recursive Character Text Splitter
 * Splits text by trying different separators in order
 */
export class RecursiveCharacterTextSplitter implements ITextChunker {
  private config: Required<Omit<ChunkingConfig, 'overlap'>>;

  constructor(config: ChunkingConfig = {}) {
    this.config = {
      ...DEFAULT_CHUNKING_CONFIG,
      ...config,
      chunkOverlap: config.overlap ?? config.chunkOverlap ?? DEFAULT_CHUNKING_CONFIG.chunkOverlap,
    };
  }

  chunk(text: string, options?: ChunkingConfig): string[] {
    const config = options ? { 
      ...this.config, 
      ...options,
      chunkOverlap: options.overlap ?? options.chunkOverlap ?? this.config.chunkOverlap 
    } : this.config;
    return this._splitText(text, config.separators, config);
  }

  private _splitText(
    text: string,
    separators: string[],
    config: Required<Omit<ChunkingConfig, 'overlap'>>
  ): string[] {
    const finalChunks: string[] = [];
    
    // Get the separator to use
    let separator = separators[separators.length - 1];
    let newSeparators: string[] = [];
    
    for (let i = 0; i < separators.length; i++) {
      const s = separators[i];
      if (s === '') {
        separator = s;
        break;
      }
      if (text.includes(s)) {
        separator = s;
        newSeparators = separators.slice(i + 1);
        break;
      }
    }

    // Split the text
    const splits = separator ? text.split(separator) : [text];
    
    // Merge splits into chunks
    let currentChunk = '';
    
    for (const split of splits) {
      const piece = config.keepSeparator && separator ? split + separator : split;
      
      if (!piece.trim()) continue;
      
      // If current piece alone is too large, split it further
      if (piece.length > config.chunkSize) {
        if (currentChunk) {
          finalChunks.push(currentChunk.trim());
          currentChunk = '';
        }
        
        if (newSeparators.length > 0) {
          // Recursively split with next separator
          const subChunks = this._splitText(piece, newSeparators, config);
          finalChunks.push(...subChunks);
        } else {
          // Force split by character count
          finalChunks.push(...this._forceSplit(piece, config.chunkSize, config.chunkOverlap));
        }
        continue;
      }
      
      // Check if adding this piece exceeds chunk size
      if (currentChunk.length + piece.length > config.chunkSize) {
        if (currentChunk) {
          finalChunks.push(currentChunk.trim());
        }
        // Start new chunk with overlap
        currentChunk = this._getOverlap(currentChunk, config.chunkOverlap) + piece;
      } else {
        currentChunk += piece;
      }
    }
    
    // Add remaining chunk
    if (currentChunk.trim()) {
      finalChunks.push(currentChunk.trim());
    }
    
    return finalChunks.filter(chunk => chunk.length > 0);
  }

  private _forceSplit(text: string, chunkSize: number, overlap: number): string[] {
    const chunks: string[] = [];
    let start = 0;
    
    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length);
      chunks.push(text.slice(start, end));
      start = end - overlap;
      
      // Prevent infinite loop
      if (start >= text.length - overlap) break;
    }
    
    return chunks;
  }

  private _getOverlap(text: string, overlapSize: number): string {
    if (text.length <= overlapSize) return text;
    return text.slice(-overlapSize);
  }
}

/**
 * Sentence-based text splitter
 * Splits text by sentences while respecting chunk size
 */
export class SentenceTextSplitter implements ITextChunker {
  private config: Required<Omit<ChunkingConfig, 'overlap'>>;
  private sentenceRegex = /[.!?]+\s+/g;

  constructor(config: ChunkingConfig = {}) {
    this.config = {
      ...DEFAULT_CHUNKING_CONFIG,
      separators: ['. ', '! ', '? '],
      ...config,
      chunkOverlap: config.overlap ?? config.chunkOverlap ?? DEFAULT_CHUNKING_CONFIG.chunkOverlap,
    };
  }

  chunk(text: string, options?: ChunkingConfig): string[] {
    const config = options ? { ...this.config, ...options } : this.config;
    
    // Split into sentences
    const sentences = this._splitIntoSentences(text);
    
    // Group sentences into chunks
    const chunks: string[] = [];
    let currentChunk = '';
    
    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length > config.chunkSize && currentChunk) {
        chunks.push(currentChunk.trim());
        
        // Start new chunk with overlap
        const words = currentChunk.split(' ');
        const overlapWords = Math.floor(config.chunkOverlap / 5); // Approximate words
        currentChunk = words.slice(-overlapWords).join(' ') + ' ' + sentence;
      } else {
        currentChunk += (currentChunk ? ' ' : '') + sentence;
      }
    }
    
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }
    
    return chunks;
  }

  private _splitIntoSentences(text: string): string[] {
    // Simple sentence splitting
    const sentences = text.split(this.sentenceRegex);
    return sentences.filter(s => s.trim().length > 0);
  }
}

/**
 * Paragraph-based text splitter
 */
export class ParagraphTextSplitter implements ITextChunker {
  private config: Required<Omit<ChunkingConfig, 'overlap'>>;

  constructor(config: ChunkingConfig = {}) {
    this.config = {
      ...DEFAULT_CHUNKING_CONFIG,
      separators: ['\n\n', '\n'],
      ...config,
      chunkOverlap: config.overlap ?? config.chunkOverlap ?? DEFAULT_CHUNKING_CONFIG.chunkOverlap,
    };
  }

  chunk(text: string, options?: ChunkingConfig): string[] {
    const config = options ? { ...this.config, ...options } : this.config;
    
    // Split by paragraphs
    const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0);
    
    const chunks: string[] = [];
    let currentChunk = '';
    
    for (const paragraph of paragraphs) {
      if (paragraph.length > config.chunkSize) {
        // Paragraph too large, use recursive splitter
        if (currentChunk) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
        
        const splitter = new RecursiveCharacterTextSplitter(config);
        chunks.push(...splitter.chunk(paragraph));
        continue;
      }
      
      if (currentChunk.length + paragraph.length + 2 > config.chunkSize && currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = paragraph;
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
      }
    }
    
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }
    
    return chunks;
  }
}

/**
 * Text Chunking Manager
 * Provides flexible text chunking with configurable strategies
 */
export class TextChunkingManager {
  private defaultChunker: ITextChunker;
  private customChunkers: Map<string, ITextChunker>;

  constructor(chunker?: ITextChunker) {
    this.defaultChunker = chunker || new RecursiveCharacterTextSplitter();
    this.customChunkers = new Map();
  }

  /**
   * Register a custom chunker with a name.
   * @param name Name to identify the chunker
   * @param chunker Custom text chunker
   */
  registerChunker(name: string, chunker: ITextChunker): void {
    this.customChunkers.set(name, chunker);
  }

  /**
   * Chunk text using the specified strategy.
   * @param text Text to chunk
   * @param strategy Name of registered chunker or 'default'
   * @param options Optional chunking configuration
   */
  chunk(text: string, strategy: string = 'default', options?: ChunkingConfig): string[] {
    if (strategy === 'default') {
      return this.defaultChunker.chunk(text, options);
    }

    const chunker = this.customChunkers.get(strategy);
    if (!chunker) {
      throw new Error(`Unknown chunking strategy: ${strategy}. Use 'default' or register a custom chunker.`);
    }

    return chunker.chunk(text, options);
  }

  /**
   * Set a new default chunker.
   */
  setDefaultChunker(chunker: ITextChunker): void {
    this.defaultChunker = chunker;
  }

  /**
   * Get available chunking strategies.
   */
  getAvailableStrategies(): string[] {
    return ['default', ...Array.from(this.customChunkers.keys())];
  }
}
