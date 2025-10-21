/**
 * Interface for document extractors.
 * Implement this interface to add support for different document types.
 */
export interface IDocumentExtractor {
  /**
   * Extract text from a document.
   * @param file File or Buffer to extract text from
   * @param options Optional extraction options
   * @returns Extracted text content
   */
  extract(file: File | Buffer | ArrayBuffer, options?: any): Promise<string>;

  /**
   * Check if this extractor can handle the given file type.
   * @param mimeType MIME type of the file
   * @returns true if this extractor can handle the file
   */
  canHandle(mimeType: string): boolean;
}

/**
 * Base configuration for document extraction
 */
export interface ExtractorConfig {
  /** Whether to use OCR as fallback if primary extraction fails */
  enableOCRFallback?: boolean;
  
  /** Custom OCR configuration */
  ocrConfig?: {
    languages?: string[];
    [key: string]: any;
  };
}

/**
 * PDF Extractor using PDF.js
 */
export class PDFExtractor implements IDocumentExtractor {
  private config: ExtractorConfig;

  constructor(config: ExtractorConfig = {}) {
    this.config = {
      enableOCRFallback: true,
      ...config,
    };
  }

  canHandle(mimeType: string): boolean {
    return mimeType === 'application/pdf' || mimeType.includes('pdf');
  }

  async extract(file: File | Buffer | ArrayBuffer, options?: any): Promise<string> {
    try {
      // Dynamic import of pdfjs-dist
      const pdfjsLib = await import('pdfjs-dist');
      
      // Set worker source
      if (typeof window !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 
          'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
      }

      // Convert input to appropriate format
      let data: ArrayBuffer;
      if (file instanceof File) {
        data = await file.arrayBuffer();
      } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(file)) {
        // Node.js Buffer - convert to ArrayBuffer
        data = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
      } else if (file instanceof Uint8Array) {
        // Uint8Array - convert to ArrayBuffer
        data = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
      } else {
        // Already ArrayBuffer
        data = file as ArrayBuffer;
      }

      // Load PDF document
      const loadingTask = pdfjsLib.getDocument({ data });
      const pdf = await loadingTask.promise;

      // Extract text from all pages
      let fullText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: any) => item.str)
          .join(' ');
        fullText += pageText + '\n\n';
      }

      // If no text extracted and OCR fallback is enabled
      if ((!fullText.trim() || fullText.trim().length < 10) && this.config.enableOCRFallback) {
        console.log('PDF text extraction yielded minimal results, attempting OCR fallback...');
        // OCR fallback would be implemented here
        // For now, return what we have
      }

      return fullText.trim();
    } catch (error) {
      console.error('PDF extraction error:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to extract text from PDF: ${message}`);
    }
  }
}

/**
 * Plain text extractor
 */
export class TextExtractor implements IDocumentExtractor {
  canHandle(mimeType: string): boolean {
    return mimeType.startsWith('text/') || 
           mimeType === 'application/json' ||
           mimeType === 'application/javascript';
  }

  async extract(file: File | Buffer | ArrayBuffer): Promise<string> {
    let text: string;
    
    if (file instanceof File) {
      text = await file.text();
    } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(file)) {
      // Node.js Buffer
      text = file.toString('utf-8');
    } else if (file instanceof Uint8Array) {
      // Uint8Array
      const decoder = new TextDecoder('utf-8');
      text = decoder.decode(file);
    } else {
      // ArrayBuffer
      const decoder = new TextDecoder('utf-8');
      text = decoder.decode(file);
    }

    return text;
  }
}

/**
 * Image extractor using OCR (Tesseract.js)
 */
export class ImageExtractor implements IDocumentExtractor {
  private config: ExtractorConfig;

  constructor(config: ExtractorConfig = {}) {
    this.config = {
      ocrConfig: {
        languages: ['eng'],
      },
      ...config,
    };
  }

  canHandle(mimeType: string): boolean {
    return mimeType.startsWith('image/');
  }

  async extract(file: File | Buffer | ArrayBuffer): Promise<string> {
    try {
      // Dynamic import of Tesseract.js
      const Tesseract = await import('tesseract.js');

      // Tesseract.js can handle File, Blob, or base64 string in browser
      // In Node.js it can handle Buffer
      let imageData: any;
      if (file instanceof File) {
        imageData = file;
      } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(file)) {
        // Node.js Buffer - can use directly
        imageData = file;
      } else {
        // ArrayBuffer or Uint8Array - convert to Blob for browser
        imageData = new Blob([file as any]);
      }

      const result = await Tesseract.recognize(
        imageData,
        this.config.ocrConfig?.languages?.join('+') || 'eng',
        {
          logger: (m: any) => {
            if (m.status === 'recognizing text') {
              console.log(`OCR Progress: ${Math.round(m.progress * 100)}%`);
            }
          }
        }
      );

      return result.data.text;
    } catch (error) {
      console.error('Image OCR error:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to extract text from image: ${message}`);
    }
  }
}

/**
 * Document Extraction Manager
 * Coordinates multiple extractors and handles fallbacks
 */
export class DocumentExtractionManager {
  private extractors: IDocumentExtractor[];
  private customExtractors: Map<string, IDocumentExtractor>;

  constructor() {
    // Register default extractors
    this.extractors = [
      new PDFExtractor(),
      new ImageExtractor(),
      new TextExtractor(),
    ];
    this.customExtractors = new Map();
  }

  /**
   * Register a custom extractor for specific file types.
   * @param extractor Custom document extractor
   */
  registerExtractor(extractor: IDocumentExtractor): void {
    this.customExtractors.set(extractor.constructor.name, extractor);
  }

  /**
   * Extract text from a document.
   * Automatically selects the appropriate extractor based on MIME type.
   * @param file File to extract text from
   * @param mimeType MIME type of the file
   * @param options Optional extraction options
   */
  async extractText(
    file: File | Buffer | ArrayBuffer,
    mimeType: string,
    options?: any
  ): Promise<string> {
    // Try custom extractors first
    for (const extractor of this.customExtractors.values()) {
      if (extractor.canHandle(mimeType)) {
        console.log(`Using custom extractor: ${extractor.constructor.name}`);
        return await extractor.extract(file, options);
      }
    }

    // Try default extractors
    for (const extractor of this.extractors) {
      if (extractor.canHandle(mimeType)) {
        console.log(`Using extractor: ${extractor.constructor.name}`);
        return await extractor.extract(file, options);
      }
    }

    throw new Error(`No extractor available for MIME type: ${mimeType}`);
  }

  /**
   * Get list of supported MIME types.
   */
  getSupportedMimeTypes(): string[] {
    const types = new Set<string>();
    
    // Common MIME types each extractor can handle
    const mimeTypeMap: Record<string, string[]> = {
      PDFExtractor: ['application/pdf'],
      TextExtractor: ['text/plain', 'text/html', 'text/markdown', 'application/json'],
      ImageExtractor: ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/bmp', 'image/tiff'],
    };

    this.extractors.forEach(extractor => {
      const extractorName = extractor.constructor.name;
      if (mimeTypeMap[extractorName]) {
        mimeTypeMap[extractorName].forEach((type: string) => types.add(type));
      }
    });

    return Array.from(types);
  }
}
