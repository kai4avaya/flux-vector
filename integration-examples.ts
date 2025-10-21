/**
 * Complete Integration Example
 * 
 * This example demonstrates the full Flux-Vector pipeline:
 * 1. Process documents (PDF, text, images)
 * 2. Extract and chunk text
 * 3. Generate embeddings
 * 4. Index in vector database
 * 5. Perform semantic search
 */

import { 
  DocumentProcessor,
  RecursiveCharacterTextSplitter,
  SentenceTextSplitter,
} from './document-processing';
import VectorSearchManager from './embeddings/VectorSearchManager';

/**
 * Main integration example
 */
async function fullPipelineExample() {
  console.log('\n=== Full Flux-Vector Pipeline Example ===\n');

  // Step 1: Initialize Components
  console.log('1. Initializing components...');
  
  const documentProcessor = new DocumentProcessor({
    extractorConfig: {
      enableOCRFallback: true,
      ocrConfig: {
        languages: ['eng'],
      },
    },
    chunkingConfig: {
      chunkSize: 800,
      chunkOverlap: 150,
    },
  });

  const vectorSearch = new VectorSearchManager({
    indexConfig: {
      distanceFunction: 'cosine-normalized',
      m: 16,
      efConstruction: 200,
      useIndexedDB: true,
    },
  });

  console.log('✓ Components initialized\n');

  // Step 2: Prepare Sample Documents
  console.log('2. Preparing sample documents...');
  
  const documents = [
    {
      content: `
        Machine Learning Fundamentals
        
        Machine learning is a subset of artificial intelligence that focuses on 
        the development of algorithms that can learn from and make predictions 
        based on data. Unlike traditional programming where rules are explicitly 
        coded, machine learning algorithms build mathematical models based on 
        sample data to make decisions without being explicitly programmed.
        
        There are three main types of machine learning:
        1. Supervised Learning: Learning from labeled data
        2. Unsupervised Learning: Finding patterns in unlabeled data
        3. Reinforcement Learning: Learning through interaction and rewards
      `,
      filename: 'ml-fundamentals.txt',
      mimeType: 'text/plain',
    },
    {
      content: `
        Deep Learning and Neural Networks
        
        Deep learning is a subset of machine learning based on artificial neural 
        networks with multiple layers. These networks are inspired by the structure 
        and function of the human brain. Deep learning has revolutionized fields 
        such as computer vision, natural language processing, and speech recognition.
        
        Key architectures include:
        - Convolutional Neural Networks (CNNs) for image processing
        - Recurrent Neural Networks (RNNs) for sequential data
        - Transformers for language understanding
      `,
      filename: 'deep-learning.txt',
      mimeType: 'text/plain',
    },
    {
      content: `
        Natural Language Processing
        
        Natural Language Processing (NLP) is a branch of artificial intelligence 
        that helps computers understand, interpret, and manipulate human language. 
        NLP combines computational linguistics with machine learning and deep 
        learning models.
        
        Common NLP tasks include:
        - Text classification
        - Named entity recognition
        - Sentiment analysis
        - Machine translation
        - Question answering
        - Text summarization
      `,
      filename: 'nlp-intro.txt',
      mimeType: 'text/plain',
    },
    {
      content: `
        Vector Databases and Semantic Search
        
        Vector databases store data as high-dimensional vectors (embeddings) 
        that represent the semantic meaning of content. This enables semantic 
        search, where queries are matched based on meaning rather than just 
        keyword matching.
        
        HNSW (Hierarchical Navigable Small World) is an efficient algorithm 
        for approximate nearest neighbor search in high-dimensional spaces. 
        It creates a multi-layer graph structure that allows for fast searches 
        while maintaining good accuracy.
      `,
      filename: 'vector-db.txt',
      mimeType: 'text/plain',
    },
  ];

  console.log(`✓ Prepared ${documents.length} sample documents\n`);

  // Step 3: Process and Index Documents
  console.log('3. Processing and indexing documents...');
  
  let totalChunks = 0;
  const documentChunks = new Map<string, any[]>();

  for (const doc of documents) {
    console.log(`\n   Processing: ${doc.filename}`);
    
    // Create a File object from content
    const file = new File([doc.content], doc.filename, { type: doc.mimeType });
    
    // Process document (extract + chunk)
    const chunks = await documentProcessor.processDocument(
      file,
      doc.mimeType,
      {
        filename: doc.filename,
        chunkingStrategy: 'default',
      }
    );
    
    console.log(`   → Extracted ${doc.content.length} characters`);
    console.log(`   → Created ${chunks.length} chunks`);
    
    // Index each chunk
    for (const chunk of chunks) {
      const chunkId = `${doc.filename}_chunk_${chunk.index}`;
      await vectorSearch.addDocument(chunk.text, chunkId);
      totalChunks++;
    }
    
    documentChunks.set(doc.filename, chunks);
    console.log(`   ✓ Indexed ${chunks.length} chunks`);
  }

  console.log(`\n✓ Total chunks indexed: ${totalChunks}\n`);

  // Step 4: Perform Semantic Searches
  console.log('4. Performing semantic searches...\n');

  const queries = [
    'What are the different types of machine learning?',
    'How do neural networks work?',
    'What is semantic search?',
    'Tell me about NLP tasks',
  ];

  for (const query of queries) {
    console.log(`\n   Query: "${query}"`);
    console.log('   ' + '─'.repeat(60));
    
    const results = await vectorSearch.search(query, 3);
    
    results.forEach((result, i) => {
      const similarity = ((1 - result.distance) * 100).toFixed(1);
      console.log(`\n   ${i + 1}. [${similarity}% similar] ${result.key}`);
      console.log(`      Preview: ${result.text.substring(0, 100)}...`);
    });
  }

  // Step 5: Demonstrate Metadata Access
  console.log('\n\n5. Accessing chunk metadata...\n');
  
  const firstDoc = documents[0];
  const chunks = documentChunks.get(firstDoc.filename);
  if (chunks && chunks.length > 0) {
    const sampleChunk = chunks[0];
    console.log('   Sample chunk metadata:');
    console.log('   ', JSON.stringify(sampleChunk.metadata, null, 2));
  }

  // Step 6: Index Statistics
  console.log('\n6. Index statistics...\n');
  const indexSize = await vectorSearch.size();
  console.log(`   Total documents in index: ${indexSize}`);
  console.log(`   Documents processed: ${documents.length}`);
  console.log(`   Average chunks per document: ${(indexSize / documents.length).toFixed(1)}`);

  console.log('\n✓ Full pipeline example completed!\n');
}

/**
 * Example with custom configurations
 */
async function customConfigurationExample() {
  console.log('\n=== Custom Configuration Example ===\n');

  // Custom chunker for smaller, sentence-based chunks
  const sentenceChunker = new SentenceTextSplitter({
    chunkSize: 400,
    chunkOverlap: 50,
  });

  const processor = new DocumentProcessor({
    chunkingConfig: {
      chunkSize: 400,
      chunkOverlap: 50,
    },
  });

  processor.registerChunker('sentence', sentenceChunker);

  // Custom HNSW configuration for higher accuracy
  const vectorSearch = new VectorSearchManager({
    indexConfig: {
      m: 32,                    // More connections
      efConstruction: 400,      // Higher quality
      distanceFunction: 'cosine-normalized',
    },
  });

  const sampleText = `
    Quantum computing harnesses the principles of quantum mechanics to process 
    information. Unlike classical computers that use bits (0 or 1), quantum 
    computers use quantum bits or qubits, which can exist in superposition.
  `;

  const file = new File([sampleText], 'quantum.txt', { type: 'text/plain' });
  
  const chunks = await processor.processDocument(file, 'text/plain', {
    filename: 'quantum.txt',
    chunkingStrategy: 'sentence',
  });

  console.log(`Custom chunking created ${chunks.length} chunks`);

  for (const chunk of chunks) {
    await vectorSearch.addDocument(chunk.text);
  }

  const results = await vectorSearch.search('What are qubits?', 2);
  console.log('\nSearch results:');
  results.forEach((r, i) => {
    console.log(`${i + 1}. ${r.text.substring(0, 80)}...`);
  });

  console.log('\n✓ Custom configuration example completed!\n');
}

/**
 * Batch processing example
 */
async function batchProcessingExample() {
  console.log('\n=== Batch Processing Example ===\n');

  const processor = new DocumentProcessor();
  const vectorSearch = new VectorSearchManager();

  // Simulate multiple documents
  const batchDocuments = Array.from({ length: 5 }, (_, i) => ({
    file: new File(
      [`Document ${i + 1} content about AI and machine learning topic ${i + 1}`],
      `doc${i + 1}.txt`,
      { type: 'text/plain' }
    ),
    mimeType: 'text/plain',
    filename: `doc${i + 1}.txt`,
  }));

  console.log(`Processing ${batchDocuments.length} documents in batch...`);

  const startTime = Date.now();
  
  const allChunks = await processor.processBatch(batchDocuments, {
    chunkingConfig: {
      chunkSize: 500,
      chunkOverlap: 50,
    },
  });

  const processingTime = Date.now() - startTime;
  
  console.log(`✓ Processed ${batchDocuments.length} documents in ${processingTime}ms`);
  console.log(`✓ Created ${allChunks.length} total chunks`);

  // Index all chunks
  for (const chunk of allChunks) {
    const id = `${chunk.metadata.filename}_${chunk.index}`;
    await vectorSearch.addDocument(chunk.text, id);
  }

  console.log(`✓ Indexed ${allChunks.length} chunks`);

  const results = await vectorSearch.search('machine learning', 3);
  console.log(`\nFound ${results.length} relevant chunks`);

  console.log('\n✓ Batch processing example completed!\n');
}

/**
 * Run all integration examples
 */
async function main() {
  console.log('═'.repeat(70));
  console.log('  FLUX-VECTOR: Complete Integration Examples');
  console.log('═'.repeat(70));

  try {
    await fullPipelineExample();
    await customConfigurationExample();
    await batchProcessingExample();

    console.log('═'.repeat(70));
    console.log('  All integration examples completed successfully!');
    console.log('═'.repeat(70));
  } catch (error) {
    console.error('\n❌ Error running examples:', error);
    if (error.stack) {
      console.error('\nStack trace:', error.stack);
    }
  }
}

// Execute if run directly
if (require.main === module) {
  main();
}

export {
  fullPipelineExample,
  customConfigurationExample,
  batchProcessingExample,
};
