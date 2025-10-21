// Import the flux-vector library components
import { DocumentProcessor } from '../../dist/document-processing/DocumentProcessor.js';
import VectorSearchManager from '../../dist/embeddings/VectorSearchManager.js';
import { DefaultEmbeddingEngine } from '../../dist/embeddings/EmbeddingPipeline.js';

// Global state
let processor = null;
let searchManager = null;
let embeddingEngine = null;
let pendingFiles = [];
let stats = {
    docs: 0,
    chunks: 0,
    indexed: 0,
    searches: 0
};

// Initialize
async function init() {
    log('Initializing Flux Vector...', 'info');
    
    try {
        // Initialize the embedding engine first (this will download the model)
        log('Loading ML model (Xenova/all-MiniLM-L6-v2)...', 'info');
        embeddingEngine = new DefaultEmbeddingEngine();
        
        // Warm up the model
        await embeddingEngine.embed('warmup');
        log('✓ ML model loaded successfully!', 'success');
        
        // Initialize document processor
        processor = new DocumentProcessor({
            chunkingConfig: { 
                chunkSize: 500, 
                overlap: 50 
            }
        });
        log('✓ Document processor initialized', 'success');
        
        // Initialize vector search manager
        searchManager = new VectorSearchManager({
            embeddingEngine: embeddingEngine,
            indexConfig: {
                distanceFunction: 'cosine-normalized',
                m: 8,
                efConstruction: 100,
                useIndexedDB: true
            }
        });
        
        // Wait for async initialization to complete (loads persisted index)
        log('Loading persisted data from IndexedDB...', 'info');
        await searchManager.ready();
        
        // Debug: Check what was loaded
        console.log('After ready() - Graph layers:', searchManager.index.graphLayers.length);
        console.log('After ready() - Entry point:', searchManager.index.entryPointKey);
        
        log('✓ Vector search manager initialized', 'success');
        
        // Check for existing data
        const existingSize = await searchManager.size();
        console.log('Existing documents in index:', existingSize);
        if (existingSize > 0) {
            log(`📦 Found ${existingSize} existing documents in IndexedDB`, 'info');
            stats.indexed = existingSize;
            updateStats();
            document.getElementById('searchBtn').disabled = false;
        }
        
        log('🚀 System ready! Upload some documents to get started.', 'success');
        
    } catch (error) {
        log(`❌ Initialization error: ${error.message}`, 'error');
        console.error(error);
    }
}

// Logging function
function log(message, type = 'info') {
    const logEl = document.getElementById('log');
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    const timestamp = new Date().toLocaleTimeString();
    entry.textContent = `[${timestamp}] ${message}`;
    logEl.appendChild(entry);
    logEl.scrollTop = logEl.scrollHeight;
}

// Format file size
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// Get MIME type from filename
function getMimeType(filename) {
    const ext = filename.split('.').pop()?.toLowerCase();
    const mimeMap = {
        'pdf': 'application/pdf',
        'txt': 'text/plain',
        'md': 'text/markdown',
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg'
    };
    return mimeMap[ext] || 'application/octet-stream';
}

// Update file list display
function updateFileList() {
    const fileListEl = document.getElementById('fileList');
    const processBtn = document.getElementById('processBtn');
    
    if (pendingFiles.length === 0) {
        fileListEl.innerHTML = '';
        processBtn.disabled = true;
        return;
    }
    
    processBtn.disabled = false;
    fileListEl.innerHTML = '<h3 style="margin-bottom: 10px;">Selected Files:</h3>';
    
    pendingFiles.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.innerHTML = `
            <div>
                <span class="name">${file.name}</span>
                <span class="size">(${formatFileSize(file.size)})</span>
            </div>
            <button class="btn" onclick="removeFile(${index})" style="padding: 5px 15px;">Remove</button>
        `;
        fileListEl.appendChild(item);
    });
}

// Remove file from pending list
window.removeFile = function(index) {
    pendingFiles.splice(index, 1);
    updateFileList();
    log(`Removed file from queue`, 'info');
};

// Update statistics display
function updateStats() {
    document.getElementById('statDocs').textContent = stats.docs;
    document.getElementById('statChunks').textContent = stats.chunks;
    document.getElementById('statIndexed').textContent = stats.indexed;
    document.getElementById('statSearches').textContent = stats.searches;
}

// Update progress bar
function updateProgress(percent, message = '') {
    const progressEl = document.getElementById('progress');
    const fillEl = document.getElementById('progressFill');
    
    progressEl.style.display = 'block';
    fillEl.style.width = percent + '%';
    fillEl.textContent = message || `${percent}%`;
    
    if (percent >= 100) {
        setTimeout(() => {
            progressEl.style.display = 'none';
            fillEl.style.width = '0%';
        }, 2000);
    }
}

// Process documents
async function processDocuments() {
    if (pendingFiles.length === 0) return;
    
    const processBtn = document.getElementById('processBtn');
    processBtn.disabled = true;
    
    log(`Processing ${pendingFiles.length} document(s)...`, 'info');
    
    const totalFiles = pendingFiles.length;
    let processedFiles = 0;
    
    try {
        for (const file of pendingFiles) {
            log(`Processing: ${file.name}`, 'info');
            
            // Read file as ArrayBuffer
            const arrayBuffer = await file.arrayBuffer();
            const buffer = new Uint8Array(arrayBuffer);
            const mimeType = getMimeType(file.name);
            
            // Process document
            const chunks = await processor.processDocument(buffer, mimeType, {
                filename: file.name,
                chunkingConfig: { chunkSize: 500, overlap: 50 }
            });
            
            log(`✓ Extracted ${chunks.length} chunk(s) from ${file.name}`, 'success');
            stats.chunks += chunks.length;
            
            // Add each chunk to the search index
            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                const docId = `${file.name}_chunk_${i}`;
                
                // Progress callback for embedding
                const embeddingProgress = (progress) => {
                    const overallProgress = Math.round(
                        ((processedFiles * 100) + 
                         ((i / chunks.length) * 100) + 
                         ((progress / chunks.length) * 100)) / totalFiles
                    );
                    updateProgress(overallProgress, `Embedding chunk ${i + 1}/${chunks.length}`);
                };
                
                await searchManager.addDocument(chunk.text, docId, {
                    filename: file.name,
                    chunkIndex: i,
                    totalChunks: chunks.length,
                    mimeType: mimeType,
                    ...chunk.metadata
                }, embeddingProgress);
                
                stats.indexed++;
            }
            
            stats.docs++;
            processedFiles++;
            
            const progress = Math.round((processedFiles / totalFiles) * 100);
            updateProgress(progress, `${processedFiles}/${totalFiles} files`);
            
            log(`✓ Indexed ${file.name} (${chunks.length} chunks)`, 'success');
        }
        
        // Clear pending files
        pendingFiles = [];
        updateFileList();
        updateStats();
        
        // Save the index structure to IndexedDB for persistence
        log('Saving index to IndexedDB...', 'info');
        await searchManager.index.saveIndex();
        
        // Verify it was saved
        const indexSize = await searchManager.index.nodes.size();
        console.log('Index saved - Node count:', indexSize);
        console.log('Graph layers:', searchManager.index.graphLayers.length);
        console.log('Entry point:', searchManager.index.entryPointKey);
        
        log('✓ Index saved successfully', 'success');
        
        // Enable search
        document.getElementById('searchBtn').disabled = false;
        
        log(`🎉 Processing complete! ${stats.docs} documents, ${stats.chunks} chunks indexed`, 'success');
        
    } catch (error) {
        log(`❌ Error processing documents: ${error.message}`, 'error');
        console.error(error);
    } finally {
        processBtn.disabled = false;
    }
}

// Perform search
async function performSearch() {
    const searchInput = document.getElementById('searchInput');
    const query = searchInput.value.trim();
    
    if (!query) {
        log('Please enter a search query', 'error');
        return;
    }
    
    const resultsEl = document.getElementById('searchResults');
    resultsEl.innerHTML = '<div style="text-align: center; padding: 20px;"><div class="spinner"></div> Searching...</div>';
    
    log(`Searching for: "${query}"`, 'info');
    
    try {
        const results = await searchManager.search(query, 10);
        stats.searches++;
        updateStats();
        
        if (results.length === 0) {
            resultsEl.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">No results found</p>';
            log('No results found', 'info');
            return;
        }
        
        log(`Found ${results.length} result(s)`, 'success');
        
        resultsEl.innerHTML = '';
        results.forEach((result, index) => {
            const item = document.createElement('div');
            item.className = 'result-item';
            
            const similarity = (result.similarity * 100).toFixed(1);
            const text = result.text.substring(0, 300) + (result.text.length > 300 ? '...' : '');
            
            item.innerHTML = `
                <div>
                    <span class="score">${similarity}% match</span>
                    <strong>Result ${index + 1}</strong>
                </div>
                <div class="text">${text}</div>
                <div class="metadata">
                    📄 ${result.metadata?.filename || 'Unknown'} 
                    | Chunk ${(result.metadata?.chunkIndex ?? 0) + 1}/${result.metadata?.totalChunks || 1}
                    | Type: ${result.metadata?.mimeType || 'Unknown'}
                </div>
            `;
            resultsEl.appendChild(item);
        });
        
    } catch (error) {
        log(`❌ Search error: ${error.message}`, 'error');
        console.error(error);
        resultsEl.innerHTML = `<p style="color: red; padding: 20px;">Error: ${error.message}</p>`;
    }
}

// Clear all data
async function clearAll() {
    if (!confirm('Are you sure you want to clear all documents and data?')) {
        return;
    }
    
    try {
        // Reinitialize search manager
        searchManager = new VectorSearchManager({
            distanceFunction: 'cosine-normalized',
            m: 8,
            efConstruction: 100,
            useIndexedDB: true
        }, embeddingEngine);
        
        pendingFiles = [];
        stats = { docs: 0, chunks: 0, indexed: 0, searches: 0 };
        
        updateFileList();
        updateStats();
        document.getElementById('searchResults').innerHTML = '';
        document.getElementById('searchInput').value = '';
        document.getElementById('searchBtn').disabled = true;
        
        log('✓ All data cleared', 'success');
    } catch (error) {
        log(`❌ Error clearing data: ${error.message}`, 'error');
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');
    const processBtn = document.getElementById('processBtn');
    const clearBtn = document.getElementById('clearBtn');
    const searchBtn = document.getElementById('searchBtn');
    const searchInput = document.getElementById('searchInput');
    
    // Upload area click
    uploadArea.addEventListener('click', () => fileInput.click());
    
    // File selection
    fileInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files);
        pendingFiles.push(...files);
        updateFileList();
        log(`Added ${files.length} file(s) to queue`, 'info');
        e.target.value = ''; // Reset input
    });
    
    // Drag and drop
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });
    
    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragover');
    });
    
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        const files = Array.from(e.dataTransfer.files);
        pendingFiles.push(...files);
        updateFileList();
        log(`Added ${files.length} file(s) via drag & drop`, 'info');
    });
    
    // Process button
    processBtn.addEventListener('click', processDocuments);
    
    // Clear button
    clearBtn.addEventListener('click', clearAll);
    
    // Search button
    searchBtn.addEventListener('click', performSearch);
    
    // Search on Enter key
    searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !searchBtn.disabled) {
            performSearch();
        }
    });
    
    // Initialize the system
    init();
});
