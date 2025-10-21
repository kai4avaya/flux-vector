/**
 * Examples for Document Processing System
 * 
 * This file demonstrates:
 * 1. Basic document processing (PDF, text, images)
 * 2. Custom chunking strategies
 * 3. Custom extractors
 * 4. Integration with VectorSearchManager
 */

import { 
  DocumentProcessor,
  RecursiveCharacterTextSplitter,
  SentenceTextSplitter,
  ParagraphTextSplitter,
  IDocumentExtractor,
  ITextChunker,
  ChunkingConfig,
} from './document-processing';
import VectorSearchManager from './embeddings/VectorSearchManager';

// ============================================
// Example 1: Basic Document Processing
// ============================================
async function basicDocumentProcessing() {
  console.log('\n=== Example 1: Basic Document Processing ===\n');
  
  // Initialize processor with default configuration
  const processor = new DocumentProcessor();

  // Simulate a PDF file (in real usage, this would be from file input or fetch)
  const pdfFile = new File(['sample pdf content'], 'document.pdf', {
    type: 'application/pdf'
  });

  // Process the document
  const chunks = await processor.processDocument(
    pdfFile,
    'application/pdf',
    {
      filename: 'document.pdf',
      chunkingStrategy: 'default',
    }
  );

  console.log(`Processed ${chunks.length} chunks from PDF`);
  chunks.forEach((chunk, i) => {
    console.log(`\nChunk ${i + 1}:`);
    console.log(`  Text: ${chunk.text.substring(0, 50)}...`);
    console.log(`  Metadata:`, chunk.metadata);
  });
}

// ============================================
// Example 2: Custom Chunking Configuration
// ============================================
async function customChunkingExample() {
  console.log('\n=== Example 2: Custom Chunking Configuration ===\n');

  // Create processor with custom chunking config
  const processor = new DocumentProcessor({
    chunkingConfig: {
      chunkSize: 500,        // Smaller chunks
      chunkOverlap: 50,      // Less overlap
      separators: ['\n\n', '\n', '. '],
    },
  });

  const textFile = new File(
    ['This is a long document. It has many sentences. ' +
     'We want to split it into smaller chunks. ' +
     'Each chunk should be meaningful.'],
    'sample.txt',
    { type: 'text/plain' }
  );

  const chunks = await processor.processDocument(
    textFile,
    'text/plain',
    {
      filename: 'sample.txt',
    }
  );

  console.log(`Created ${chunks.length} chunks with custom configuration`);
}

// ============================================
// Example 3: Different Chunking Strategies
// ============================================
async function chunkingStrategiesExample() {
  console.log('\n=== Example 3: Different Chunking Strategies ===\n');

  const processor = new DocumentProcessor();

  // Register multiple chunking strategies
  processor.registerChunker('sentence', new SentenceTextSplitter({
    chunkSize: 800,
    chunkOverlap: 100,
  }));

  processor.registerChunker('paragraph', new ParagraphTextSplitter({
    chunkSize: 1200,
    chunkOverlap: 150,
  }));

  const longText = `
    This is the first paragraph. It contains several sentences.
    This helps demonstrate paragraph-based chunking.
    
    This is the second paragraph. It's separate from the first.
    Paragraph chunking will treat this as a distinct unit.
    
    Here's a third paragraph for good measure.
  `;

  const textFile = new File([longText], 'essay.txt', { type: 'text/plain' });

  // Try different strategies
  console.log('Available strategies:', processor.getChunkingStrategies());

  for (const strategy of ['default', 'sentence', 'paragraph']) {
    const chunks = await processor.processDocument(
      textFile,
      'text/plain',
      {
        filename: 'essay.txt',
        chunkingStrategy: strategy,
      }
    );
    console.log(`\n${strategy} strategy: ${chunks.length} chunks`);
  }
}

// ============================================
// Example 4: Custom Document Extractor
// ============================================

/**
 * Example: Custom Markdown extractor
 */
class MarkdownExtractor implements IDocumentExtractor {
  canHandle(mimeType: string): boolean {
    return mimeType === 'text/markdown' || mimeType === 'text/x-markdown';
  }

  async extract(file: File | Buffer | ArrayBuffer): Promise<string> {
    let text: string;
    
    if (file instanceof File) {
      text = await file.text();
    } else if (Buffer.isBuffer(file)) {
      text = file.toString('utf-8');
    } else {
      const decoder = new TextDecoder('utf-8');
      text = decoder.decode(file);
    }

    // Remove markdown syntax (simple example)
    text = text
      .replace(/#{1,6}\s+/g, '') // Remove headers
      .replace(/\*\*(.+?)\*\*/g, '$1') // Remove bold
      .replace(/\*(.+?)\*/g, '$1') // Remove italic
      .replace(/\[(.+?)\]\(.+?\)/g, '$1') // Remove links
      .replace(/`(.+?)`/g, '$1'); // Remove inline code

    return text;
  }
}

async function customExtractorExample() {
  console.log('\n=== Example 4: Custom Document Extractor ===\n');

  const processor = new DocumentProcessor({
    customExtractors: [new MarkdownExtractor()],
  });

  const mdFile = new File(
    ['# Title\n\nThis is **bold** and *italic* text.\n\n[Link](http://example.com)'],
    'readme.md',
    { type: 'text/markdown' }
  );

  const chunks = await processor.processDocument(
    mdFile,
    'text/markdown',
    {
      filename: 'readme.md',
      skipChunking: true, // Get raw extracted text
    }
  );

  console.log('Extracted markdown (cleaned):', chunks[0].text);
}

// ============================================
// Example 5: Integration with Vector Search
// ============================================
async function vectorSearchIntegration() {
  console.log('\n=== Example 5: Integration with Vector Search ===\n');

  // Initialize document processor
  const processor = new DocumentProcessor({
    chunkingConfig: {
      chunkSize: 1000,
      chunkOverlap: 200,
    },
  });

  // Initialize vector search manager
  const searchManager = new VectorSearchManager();

  // Simulate processing a document
  const documentText = `
    Artificial intelligence (AI) is transforming many industries.
    Machine learning is a subset of AI that focuses on learning from data.
    Deep learning uses neural networks with multiple layers.
    Natural language processing helps computers understand human language.
  `;

  const file = new File([documentText], 'ai-intro.txt', { type: 'text/plain' });

  // Process and index the document
  const chunks = await processor.processDocument(
    file,
    'text/plain',
    {
      filename: 'ai-intro.txt',
      chunkingStrategy: 'default',
    }
  );

  console.log(`Processing ${chunks.length} chunks...`);

  // Add each chunk to vector search
  for (const chunk of chunks) {
    const docId = `${chunk.metadata.filename}_chunk_${chunk.index}`;
    await searchManager.addDocument(chunk.text, docId);
    console.log(`Indexed: ${docId}`);
  }

  // Search across the indexed chunks
  const results = await searchManager.search('What is machine learning?', 3);
  
  console.log('\nSearch Results:');
  results.forEach((result, i) => {
    console.log(`\n${i + 1}. [${((1 - result.distance) * 100).toFixed(1)}% similar]`);
    console.log(`   ID: ${result.key}`);
    console.log(`   Text: ${result.text.substring(0, 100)}...`);
  });
}

// ============================================
// Example 6: Batch Document Processing
// ============================================
async function batchProcessingExample() {
  console.log('\n=== Example 6: Batch Document Processing ===\n');

  const processor = new DocumentProcessor();

  const documents = [
    {
      file: new File(['Document 1 content'], 'doc1.txt', { type: 'text/plain' }),
      mimeType: 'text/plain',
      filename: 'doc1.txt',
    },
    {
      file: new File(['Document 2 content'], 'doc2.txt', { type: 'text/plain' }),
      mimeType: 'text/plain',
      filename: 'doc2.txt',
    },
    {
      file: new File(['Document 3 content'], 'doc3.txt', { type: 'text/plain' }),
      mimeType: 'text/plain',
      filename: 'doc3.txt',
    },
  ];

  const allChunks = await processor.processBatch(documents, {
    chunkingConfig: {
      chunkSize: 500,
      chunkOverlap: 50,
    },
  });

  console.log(`Processed ${documents.length} documents into ${allChunks.length} total chunks`);
  
  // Group by document
  const byDocument = allChunks.reduce((acc, chunk) => {
    const filename = chunk.metadata.filename || 'unknown';
    if (!acc[filename]) acc[filename] = [];
    acc[filename].push(chunk);
    return acc;
  }, {} as Record<string, any[]>);

  Object.entries(byDocument).forEach(([filename, chunks]) => {
    console.log(`  ${filename}: ${chunks.length} chunks`);
  });
}

// ============================================
// Example 7: Custom Chunker Implementation
// ============================================

/**
 * Example: Custom fixed-size chunker with word boundaries
 */
class FixedWordChunker implements ITextChunker {
  private wordsPerChunk: number;

  constructor(wordsPerChunk: number = 100) {
    this.wordsPerChunk = wordsPerChunk;
  }

  chunk(text: string): string[] {
    const words = text.split(/\s+/);
    const chunks: string[] = [];
    
    for (let i = 0; i < words.length; i += this.wordsPerChunk) {
      const chunkWords = words.slice(i, i + this.wordsPerChunk);
      chunks.push(chunkWords.join(' '));
    }
    
    return chunks;
  }
}

async function customChunkerExample() {
  console.log('\n=== Example 7: Custom Chunker Implementation ===\n');

  const processor = new DocumentProcessor();
  
  // Register custom word-based chunker
  processor.registerChunker('fixed-word', new FixedWordChunker(50));

  const text = 'The quick brown fox jumps over the lazy dog. '.repeat(20);
  const file = new File([text], 'repeated.txt', { type: 'text/plain' });

  const chunks = await processor.processDocument(
    file,
    'text/plain',
    {
      filename: 'repeated.txt',
      chunkingStrategy: 'fixed-word',
    }
  );

  console.log(`Fixed-word chunker created ${chunks.length} chunks`);
  chunks.forEach((chunk, i) => {
    const wordCount = chunk.text.split(/\s+/).length;
    console.log(`  Chunk ${i + 1}: ${wordCount} words`);
  });
}

// ============================================
// Run All Examples
// ============================================
async function main() {
  console.log('Document Processing Examples');
  console.log('============================');

  try {
    await basicDocumentProcessing();
    await customChunkingExample();
    await chunkingStrategiesExample();
    await customExtractorExample();
    await vectorSearchIntegration();
    await batchProcessingExample();
    await customChunkerExample();

    console.log('\n=== All examples completed! ===\n');
  } catch (error) {
    console.error('Error running examples:', error);
  }
}

// Execute if run directly
if (require.main === module) {
  main();
}

export {
  basicDocumentProcessing,
  customChunkingExample,
  chunkingStrategiesExample,
  customExtractorExample,
  vectorSearchIntegration,
  batchProcessingExample,
  customChunkerExample,
};
