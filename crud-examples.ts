// crud-examples.ts - Practical examples of CRUD operations

import VectorSearchManager from './embeddings/VectorSearchManager';
import { DocumentProcessor } from './document-processing/DocumentProcessor';

/**
 * Example 1: Basic CRUD operations
 */
async function basicCRUDExample() {
  console.log('\n=== Example 1: Basic CRUD Operations ===\n');
  
  const manager = new VectorSearchManager({
    indexConfig: {
      m: 8,
      efConstruction: 100,
      useIndexedDB: false, // Use memory for demo
    }
  });

  // CREATE
  console.log('1. Creating documents...');
  const doc1 = await manager.addDocument(
    'Machine learning is a subset of artificial intelligence',
    'ml-intro'
  );
  const doc2 = await manager.addDocument(
    'Deep learning uses neural networks with multiple layers',
    'dl-intro'
  );
  const doc3 = await manager.addDocument(
    'Natural language processing enables computers to understand text',
    'nlp-intro'
  );
  console.log(`Created 3 documents: ${doc1}, ${doc2}, ${doc3}`);

  // READ - Search
  console.log('\n2. Searching for "neural networks"...');
  const searchResults = await manager.search('neural networks', 3);
  searchResults.forEach((result, i) => {
    console.log(`  ${i + 1}. [${result.key}] ${result.text} (distance: ${result.distance.toFixed(4)})`);
  });

  // READ - Get specific document
  console.log('\n3. Getting specific document...');
  const document = await manager.getDocument('ml-intro');
  console.log(`  Document 'ml-intro': ${document?.text}`);

  // UPDATE
  console.log('\n4. Updating document...');
  await manager.updateDocument(
    'ml-intro',
    'Machine learning enables computers to learn from data without explicit programming'
  );
  const updated = await manager.getDocument('ml-intro');
  console.log(`  Updated 'ml-intro': ${updated?.text}`);

  // DELETE
  console.log('\n5. Deleting document...');
  await manager.deleteDocument('nlp-intro');
  const deleted = await manager.getDocument('nlp-intro');
  console.log(`  Document 'nlp-intro' after deletion: ${deleted || 'Not found'}`);

  // STATS
  console.log('\n6. Index statistics:');
  const stats = await manager.getStats();
  console.log(`  Total nodes: ${stats.totalNodes}`);
  console.log(`  Active nodes: ${stats.activeNodes}`);
  console.log(`  Deleted nodes: ${stats.deletedNodes}`);
}

/**
 * Example 2: Document lifecycle management
 */
async function documentLifecycleExample() {
  console.log('\n=== Example 2: Document Lifecycle Management ===\n');
  
  const manager = new VectorSearchManager({
    indexConfig: { useIndexedDB: false }
  });

  // Track document versions
  const versions: Map<string, number> = new Map();

  async function createOrUpdateDocument(id: string, text: string) {
    const exists = await manager.hasDocument(id);
    
    if (exists) {
      console.log(`Updating document ${id} (v${versions.get(id)} → v${versions.get(id)! + 1})`);
      await manager.updateDocument(id, text);
      versions.set(id, versions.get(id)! + 1);
    } else {
      console.log(`Creating new document ${id} (v1)`);
      await manager.addDocument(text, id);
      versions.set(id, 1);
    }
  }

  // Initial creation
  await createOrUpdateDocument('doc-1', 'Version 1 content');
  await createOrUpdateDocument('doc-2', 'Another document');

  // Updates
  await createOrUpdateDocument('doc-1', 'Version 2 content - updated');
  await createOrUpdateDocument('doc-1', 'Version 3 content - revised again');

  // Try to create (will update instead)
  await createOrUpdateDocument('doc-1', 'Version 4 content - final revision');

  console.log('\nFinal versions:');
  for (const [id, version] of versions) {
    const doc = await manager.getDocument(id);
    console.log(`  ${id}: v${version} - "${doc?.text}"`);
  }
}

/**
 * Example 3: Batch operations with progress tracking
 */
async function batchOperationsExample() {
  console.log('\n=== Example 3: Batch Operations ===\n');
  
  const manager = new VectorSearchManager({
    indexConfig: { useIndexedDB: false }
  });

  // Simulate batch document processing
  const documents = [
    { id: 'article-1', text: 'Introduction to TypeScript programming' },
    { id: 'article-2', text: 'Advanced TypeScript features and patterns' },
    { id: 'article-3', text: 'Building web applications with React' },
    { id: 'article-4', text: 'Node.js backend development guide' },
    { id: 'article-5', text: 'Database design and optimization' },
  ];

  console.log(`Processing ${documents.length} documents...`);
  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    await manager.addDocument(doc.text, doc.id);
    console.log(`  [${i + 1}/${documents.length}] Added ${doc.id}`);
  }

  console.log('\nBatch search test:');
  const results = await manager.search('programming', 3);
  results.forEach(r => console.log(`  - ${r.key}: ${r.text.substring(0, 50)}...`));

  // Batch delete odd-numbered articles
  console.log('\nDeleting articles 1, 3, 5...');
  await manager.deleteDocument('article-1');
  await manager.deleteDocument('article-3');
  await manager.deleteDocument('article-5');

  const stats = await manager.getStats();
  console.log(`\nAfter deletions: ${stats.activeNodes} active, ${stats.deletedNodes} deleted`);
}

/**
 * Example 4: Index compaction strategy
 */
async function compactionExample() {
  console.log('\n=== Example 4: Index Compaction ===\n');
  
  const manager = new VectorSearchManager({
    indexConfig: { useIndexedDB: false }
  });

  // Add many documents
  console.log('Adding 20 documents...');
  for (let i = 0; i < 20; i++) {
    await manager.addDocument(`Document ${i} content`, `doc-${i}`);
  }

  let stats = await manager.getStats();
  console.log(`Initial: ${stats.totalNodes} total, ${stats.activeNodes} active`);

  // Delete half
  console.log('\nDeleting 10 documents...');
  for (let i = 0; i < 10; i++) {
    await manager.deleteDocument(`doc-${i}`);
  }

  stats = await manager.getStats();
  console.log(`After deletion: ${stats.totalNodes} total, ${stats.activeNodes} active, ${stats.deletedNodes} deleted`);
  
  const deletionRatio = stats.deletedNodes / stats.totalNodes;
  console.log(`Deletion ratio: ${(deletionRatio * 100).toFixed(1)}%`);

  if (deletionRatio > 0.25) {
    console.log('\n⚠️  Deletion ratio exceeds 25%, compacting...');
    await manager.compactIndex();
    
    stats = await manager.getStats();
    console.log(`After compaction: ${stats.totalNodes} total, ${stats.activeNodes} active, ${stats.deletedNodes} deleted`);
    console.log(`✓ Reclaimed ${10} nodes from memory`);
  }
}

/**
 * Example 5: Error handling and validation
 */
async function errorHandlingExample() {
  console.log('\n=== Example 5: Error Handling ===\n');
  
  const manager = new VectorSearchManager({
    indexConfig: { useIndexedDB: false }
  });

  // Safe update function
  async function safeUpdate(id: string, text: string) {
    try {
      console.log(`Attempting to update ${id}...`);
      const exists = await manager.hasDocument(id);
      
      if (!exists) {
        console.log(`  Document ${id} doesn't exist, creating instead...`);
        await manager.addDocument(text, id);
        return 'created';
      }
      
      await manager.updateDocument(id, text);
      return 'updated';
    } catch (error) {
      console.error(`  Error: ${(error as Error).message}`);
      return 'failed';
    }
  }

  // Safe delete function
  async function safeDelete(id: string) {
    try {
      console.log(`Attempting to delete ${id}...`);
      const exists = await manager.hasDocument(id);
      
      if (!exists) {
        console.log(`  Document ${id} doesn't exist or already deleted`);
        return 'not_found';
      }
      
      await manager.deleteDocument(id);
      console.log(`  Successfully deleted ${id}`);
      return 'deleted';
    } catch (error) {
      console.error(`  Error: ${(error as Error).message}`);
      return 'failed';
    }
  }

  // Test safe operations
  await safeUpdate('doc-1', 'Initial content'); // Will create
  await safeUpdate('doc-1', 'Updated content'); // Will update
  await safeDelete('doc-1'); // Will delete
  await safeDelete('doc-1'); // Will report not found
  await safeUpdate('doc-1', 'Recreated content'); // Will create again
}

/**
 * Example 6: Working with document chunks
 */
async function chunkedDocumentExample() {
  console.log('\n=== Example 6: Chunked Document Management ===\n');
  
  const manager = new VectorSearchManager({
    indexConfig: { useIndexedDB: false }
  });

  const processor = new DocumentProcessor();

  // Simulate a large document split into chunks
  const documentId = 'large-doc-1';
  const chunks = [
    'This is the first chunk of a large document about machine learning.',
    'The second chunk discusses neural networks and deep learning.',
    'The final chunk covers practical applications in industry.'
  ];

  console.log(`Adding document '${documentId}' with ${chunks.length} chunks...`);
  for (let i = 0; i < chunks.length; i++) {
    const chunkId = `${documentId}_chunk_${i}`;
    await manager.addDocument(chunks[i], chunkId);
    console.log(`  Added ${chunkId}`);
  }

  // Search across chunks
  console.log('\nSearching for "neural networks"...');
  const results = await manager.search('neural networks', 3);
  results.forEach(r => {
    console.log(`  ${r.key}: "${r.text}"`);
  });

  // Update all chunks of a document
  console.log('\nUpdating all chunks of the document...');
  const newChunks = [
    'Updated first chunk with new information.',
    'Updated second chunk with revised content.',
    'Updated third chunk with latest data.'
  ];

  for (let i = 0; i < newChunks.length; i++) {
    const chunkId = `${documentId}_chunk_${i}`;
    await manager.updateDocument(chunkId, newChunks[i]);
  }
  console.log('All chunks updated');

  // Delete entire document (all chunks)
  console.log('\nDeleting entire document...');
  for (let i = 0; i < chunks.length; i++) {
    const chunkId = `${documentId}_chunk_${i}`;
    await manager.deleteDocument(chunkId);
  }
  console.log('Document deleted');

  const stats = await manager.getStats();
  console.log(`\nFinal stats: ${stats.activeNodes} active, ${stats.deletedNodes} deleted`);
}

/**
 * Example 7: Real-time document monitoring
 */
async function monitoringExample() {
  console.log('\n=== Example 7: Index Monitoring ===\n');
  
  const manager = new VectorSearchManager({
    indexConfig: { useIndexedDB: false }
  });

  async function printIndexHealth() {
    const stats = await manager.getStats();
    const size = await manager.size();
    
    console.log('Index Health Report:');
    console.log(`  Total Nodes: ${stats.totalNodes}`);
    console.log(`  Active Nodes: ${stats.activeNodes}`);
    console.log(`  Deleted Nodes: ${stats.deletedNodes}`);
    console.log(`  Index Size: ${size}`);
    
    if (stats.totalNodes > 0) {
      const fragmentation = (stats.deletedNodes / stats.totalNodes * 100).toFixed(1);
      console.log(`  Fragmentation: ${fragmentation}%`);
      
      if (Number(fragmentation) > 25) {
        console.log('  ⚠️  Warning: High fragmentation. Consider compacting.');
      } else {
        console.log('  ✓ Index health: Good');
      }
    }
    console.log();
  }

  // Perform operations and monitor
  console.log('Initial state:');
  await printIndexHealth();

  console.log('Adding documents...');
  for (let i = 0; i < 10; i++) {
    await manager.addDocument(`Document ${i}`, `doc-${i}`);
  }
  await printIndexHealth();

  console.log('Deleting some documents...');
  for (let i = 0; i < 4; i++) {
    await manager.deleteDocument(`doc-${i}`);
  }
  await printIndexHealth();

  console.log('Compacting index...');
  await manager.compactIndex();
  await printIndexHealth();
}

/**
 * Example 8: Knowledge base with tags
 */
async function knowledgeBaseExample() {
  console.log('\n=== Example 8: Tagged Knowledge Base ===\n');
  
  const manager = new VectorSearchManager({
    indexConfig: { useIndexedDB: false }
  });

  // Store metadata alongside documents
  const metadata = new Map<string, { tags: string[], created: Date, updated: Date }>();

  async function addArticle(id: string, text: string, tags: string[]) {
    await manager.addDocument(text, id);
    metadata.set(id, {
      tags,
      created: new Date(),
      updated: new Date()
    });
    console.log(`Added article '${id}' with tags: [${tags.join(', ')}]`);
  }

  async function updateArticle(id: string, text: string) {
    await manager.updateDocument(id, text);
    const meta = metadata.get(id);
    if (meta) {
      meta.updated = new Date();
    }
    console.log(`Updated article '${id}'`);
  }

  async function findByTag(tag: string): Promise<string[]> {
    return Array.from(metadata.entries())
      .filter(([_, meta]) => meta.tags.includes(tag))
      .map(([id, _]) => id);
  }

  // Add articles
  await addArticle('ts-guide', 'TypeScript programming guide', ['typescript', 'programming', 'guide']);
  await addArticle('react-tutorial', 'React component tutorial', ['react', 'frontend', 'tutorial']);
  await addArticle('node-api', 'Building APIs with Node.js', ['nodejs', 'backend', 'api']);

  // Update an article
  console.log();
  await updateArticle('ts-guide', 'Comprehensive TypeScript programming guide with examples');

  // Find by tag
  console.log('\nArticles tagged with "programming":');
  const programmingArticles = await findByTag('programming');
  for (const id of programmingArticles) {
    const doc = await manager.getDocument(id);
    console.log(`  ${id}: ${doc?.text.substring(0, 50)}...`);
  }

  // Semantic search
  console.log('\nSemantic search for "javascript":');
  const results = await manager.search('javascript', 3);
  results.forEach(r => {
    const meta = metadata.get(r.key);
    console.log(`  ${r.key} [${meta?.tags.join(', ')}]`);
    console.log(`    ${r.text.substring(0, 60)}...`);
  });
}

// Main execution
async function runAllExamples() {
  try {
    await basicCRUDExample();
    await documentLifecycleExample();
    await batchOperationsExample();
    await compactionExample();
    await errorHandlingExample();
    await chunkedDocumentExample();
    await monitoringExample();
    await knowledgeBaseExample();
    
    console.log('\n✓ All examples completed successfully!\n');
  } catch (error) {
    console.error('\n✗ Error running examples:', error);
  }
}

// Run examples if this file is executed directly
if (require.main === module) {
  runAllExamples();
}

export {
  basicCRUDExample,
  documentLifecycleExample,
  batchOperationsExample,
  compactionExample,
  errorHandlingExample,
  chunkedDocumentExample,
  monitoringExample,
  knowledgeBaseExample,
};
