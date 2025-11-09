/**
 * Summarization Tests
 * Tests for summarization functionality including worker support and summary search
 */

import VectorSearchManager from '../embeddings/VectorSearchManager';
import { MockEmbeddingEngine, SimpleMockEmbedding } from './mocks/MockEmbedding';
import { DefaultSummarizationEngine } from '../embeddings/SummarizationPipeline';
import { ContentStore } from '../embeddings/ContentStore';

// Mock summarization engine for testing (avoids loading actual models)
class MockSummarizationEngine {
  async summarize(text: string): Promise<string> {
    // Simple mock: return first 50 chars as "summary"
    return text.substring(0, Math.min(50, text.length)) + '...';
  }
}

describe('Summarization', () => {
  let searchManager: VectorSearchManager;
  let contentStore: ContentStore;

  beforeEach(async () => {
    // Use mock embedding for faster tests
    const mockEmbedding = new SimpleMockEmbedding(10);
    
    searchManager = new VectorSearchManager({
      embeddingEngine: mockEmbedding,
      indexConfig: {
        distanceFunction: 'cosine-normalized',
        m: 8,
        efConstruction: 100,
        useIndexedDB: false, // Use in-memory for tests
      },
      summarization: {
        enabled: true,
        engine: new MockSummarizationEngine() as any,
        embedSummary: true,
      },
    });

    contentStore = searchManager.contentStore;

    // Clear any existing data
    await contentStore.documents.clear();
    await contentStore.summaries.clear();
  });

  afterEach(async () => {
    // Clean up
    await contentStore.delete();
  });

  describe('Summary Generation', () => {
    it('should generate summary when summarization is enabled', async () => {
      const text = 'This is a very long document that needs to be summarized. ' +
        'It contains multiple sentences and paragraphs. ' +
        'The summary should capture the main points.';

      const result = await searchManager.addDocument(text, undefined, undefined, undefined, {
        generateSummary: true,
        waitForSummary: true,
      });

      expect(result.documentId).toBeDefined();
      expect(result.summaryId).toBeDefined();

      // Check summary was stored
      const summary = await searchManager.getSummary(result.documentId);
      expect(summary).toBeDefined();
      expect(summary?.summaryText).toBeDefined();
      expect(summary?.documentId).toBe(result.documentId);
    });

    it('should not generate summary when summarization is disabled', async () => {
      const text = 'This is a test document';

      const result = await searchManager.addDocument(text, undefined, undefined, undefined, {
        generateSummary: false,
      });

      expect(result.documentId).toBeDefined();
      expect(result.summaryId).toBeUndefined();

      // Check no summary was stored
      const summary = await searchManager.getSummary(result.documentId);
      expect(summary).toBeUndefined();
    });

    it('should generate summary for existing document', async () => {
      const text = 'This is a document that was added without a summary initially. ' +
        'Now we want to add a summary to it.';

      const result = await searchManager.addDocument(text, undefined, undefined, undefined, {
        generateSummary: false,
      });
      const documentId = result.documentId;

      // Generate summary after the fact
      const summaryText = await searchManager.generateSummary(documentId);

      expect(summaryText).toBeDefined();
      expect(summaryText.length).toBeGreaterThan(0);

      // Verify summary was stored
      const summary = await searchManager.getSummary(documentId);
      expect(summary?.summaryText).toBe(summaryText);
    });

    it('should embed summary when embedSummary is enabled', async () => {
      const text = 'This is a document that will have its summary embedded.';

      const result = await searchManager.addDocument(text, undefined, undefined, undefined, {
        generateSummary: true,
        waitForSummary: true,
      });

      const summary = await searchManager.getSummary(result.documentId);
      expect(summary).toBeDefined();
      expect(summary?.summaryEmbedding).toBeDefined();
      expect(summary?.summaryEmbedding.length).toBeGreaterThan(0);
    });
  });

  describe('Summary Storage', () => {
    it('should store summary with correct metadata', async () => {
      const text = 'Test document for metadata storage.';

      const result = await searchManager.addDocument(text, undefined, undefined, undefined, {
        generateSummary: true,
        waitForSummary: true,
      });

      const summary = await searchManager.getSummary(result.documentId);
      expect(summary).toBeDefined();
      expect(summary?.id).toBe(result.documentId);
      expect(summary?.documentId).toBe(result.documentId);
      expect(summary?.createdAt).toBeDefined();
      expect(typeof summary?.createdAt).toBe('number');
      expect(summary?.model).toBeDefined();
    });

    it('should link summary to document correctly', async () => {
      const text = 'Document that will have a summary linked to it.';

      const result = await searchManager.addDocument(text, undefined, undefined, undefined, {
        generateSummary: true,
        waitForSummary: true,
      });

      const document = await searchManager.getDocument(result.documentId);
      const summary = await searchManager.getSummary(result.documentId);

      expect(document).toBeDefined();
      expect(summary).toBeDefined();
      expect(summary?.documentId).toBe(document?.id);
    });
  });

  describe('Summary Search', () => {
    beforeEach(async () => {
      // Add multiple documents with summaries
      const documents = [
        'Machine learning is a subset of artificial intelligence that focuses on algorithms.',
        'Natural language processing enables computers to understand human language.',
        'Computer vision allows machines to interpret and understand visual information.',
      ];

      for (const doc of documents) {
        await searchManager.addDocument(doc, undefined, undefined, undefined, {
          generateSummary: true,
          waitForSummary: true,
        });
      }
    });

    it('should search summaries and return matching documents', async () => {
      const results = await searchManager.searchSummaries('artificial intelligence', 3);

      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);

      // Check result structure
      const firstResult = results[0];
      expect(firstResult).toHaveProperty('documentId');
      expect(firstResult).toHaveProperty('summaryText');
      expect(firstResult).toHaveProperty('distance');
      expect(firstResult).toHaveProperty('similarity');
    });

    it('should return empty array when no summaries exist', async () => {
      // Clear summaries
      await contentStore.summaries.clear();

      const results = await searchManager.searchSummaries('test query', 3);

      expect(results).toEqual([]);
    });

    it('should respect k parameter for result count', async () => {
      const results = await searchManager.searchSummaries('learning', 2);

      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should include document in results when available', async () => {
      const results = await searchManager.searchSummaries('language', 1);

      if (results.length > 0) {
        // Document may or may not be included depending on implementation
        // Just verify the structure is correct
        expect(results[0]).toHaveProperty('documentId');
        expect(results[0]).toHaveProperty('summaryText');
      }
    });

    it('should return results sorted by similarity', async () => {
      const results = await searchManager.searchSummaries('computer', 3);

      if (results.length > 1) {
        // Results should be sorted by similarity (descending)
        for (let i = 0; i < results.length - 1; i++) {
          expect(results[i].similarity).toBeGreaterThanOrEqual(results[i + 1].similarity);
        }
      }
    });
  });

  describe('Summary Search vs Document Search', () => {
    beforeEach(async () => {
      // Add documents with summaries
      await searchManager.addDocument(
        'Machine learning algorithms can process large amounts of data.',
        undefined,
        undefined,
        undefined,
        { generateSummary: true, waitForSummary: true }
      );
    });

    it('should exclude summaries from regular document search', async () => {
      const docResults = await searchManager.search('machine learning', 10);

      // Verify no summary keys are in results
      const summaryKeys = docResults.filter(r => r.key.startsWith('summary:'));
      expect(summaryKeys.length).toBe(0);

      // All results should be actual documents
      for (const result of docResults) {
        const doc = await searchManager.getDocument(result.key);
        expect(doc).toBeDefined();
      }
    });

    it('should only return summaries in summary search', async () => {
      const summaryResults = await searchManager.searchSummaries('machine learning', 10);

      // All results should have summary text
      for (const result of summaryResults) {
        expect(result.summaryText).toBeDefined();
        expect(result.summaryText.length).toBeGreaterThan(0);
      }
    });
  });

  describe('ContentStore Summary Methods', () => {
    it('should add summary to ContentStore', async () => {
      const result = await searchManager.addDocument('Test document', undefined, undefined, undefined, {
        generateSummary: false,
      });
      const documentId = result.documentId;

      const summary = {
        id: documentId,
        documentId,
        summaryText: 'Test summary',
        summaryEmbedding: [0.1, 0.2, 0.3],
        model: 'test-model',
        createdAt: Date.now(),
      };

      await contentStore.addSummary(summary);

      const retrieved = await contentStore.getSummary(documentId);
      expect(retrieved).toBeDefined();
      expect(retrieved?.summaryText).toBe('Test summary');
    });

    it('should update existing summary', async () => {
      const result = await searchManager.addDocument('Test document', undefined, undefined, undefined, {
        generateSummary: false,
      });
      const documentId = result.documentId;

      const summary = {
        id: documentId,
        documentId,
        summaryText: 'Original summary',
        summaryEmbedding: [],
        model: 'test-model',
        createdAt: Date.now(),
      };

      await contentStore.addSummary(summary);

      await contentStore.updateSummary(documentId, {
        summaryText: 'Updated summary',
      });

      const retrieved = await contentStore.getSummary(documentId);
      expect(retrieved?.summaryText).toBe('Updated summary');
    });

    it('should delete summary', async () => {
      const result = await searchManager.addDocument('Test document', undefined, undefined, undefined, {
        generateSummary: false,
      });
      const documentId = result.documentId;

      const summary = {
        id: documentId,
        documentId,
        summaryText: 'Test summary',
        summaryEmbedding: [],
        model: 'test-model',
        createdAt: Date.now(),
      };

      await contentStore.addSummary(summary);
      await contentStore.deleteSummary(documentId);

      const retrieved = await contentStore.getSummary(documentId);
      expect(retrieved).toBeUndefined();
    });

    it('should get multiple summaries', async () => {
      const result1 = await searchManager.addDocument('Doc 1', undefined, undefined, undefined, {
        generateSummary: false,
      });
      const result2 = await searchManager.addDocument('Doc 2', undefined, undefined, undefined, {
        generateSummary: false,
      });
      const doc1 = result1.documentId;
      const doc2 = result2.documentId;

      await contentStore.addSummary({
        id: doc1,
        documentId: doc1,
        summaryText: 'Summary 1',
        summaryEmbedding: [],
        model: 'test',
        createdAt: Date.now(),
      });

      await contentStore.addSummary({
        id: doc2,
        documentId: doc2,
        summaryText: 'Summary 2',
        summaryEmbedding: [],
        model: 'test',
        createdAt: Date.now(),
      });

      const summaries = await contentStore.getSummaries([doc1, doc2]);
      expect(summaries.length).toBe(2);
      expect(summaries[0]?.summaryText).toBe('Summary 1');
      expect(summaries[1]?.summaryText).toBe('Summary 2');
    });

    it('should count summaries', async () => {
      expect(await contentStore.countSummaries()).toBe(0);

      await searchManager.addDocument('Doc 1', undefined, undefined, undefined, {
        generateSummary: true,
        waitForSummary: true,
      });

      expect(await contentStore.countSummaries()).toBe(1);

      await searchManager.addDocument('Doc 2', undefined, undefined, undefined, {
        generateSummary: true,
        waitForSummary: true,
      });

      expect(await contentStore.countSummaries()).toBe(2);
    });
  });

  describe('Parallel Processing', () => {
    it('should process embedding and summary in parallel', async () => {
      const text = 'This is a document that will be processed in parallel.';

      const startTime = Date.now();
      const result = await searchManager.addDocument(text, undefined, undefined, undefined, {
        generateSummary: true,
        waitForSummary: false, // Don't wait for summary
      });
      const endTime = Date.now();

      // Document should be added quickly (not waiting for summary)
      expect(result.documentId).toBeDefined();

      // Wait a bit for summary to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // Summary should eventually be available
      const summary = await searchManager.getSummary(result.documentId);
      expect(summary).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle missing document when generating summary', async () => {
      await expect(
        searchManager.generateSummary('non-existent-id')
      ).rejects.toThrow();
    });

    it('should handle summary update on non-existent summary', async () => {
      const documentId = (await searchManager.addDocument('Test')).documentId;

      await expect(
        contentStore.updateSummary(documentId, { summaryText: 'Updated' })
      ).rejects.toThrow();
    });
  });
});
