# Flux Vector - Real Embedding Tester

This is an interactive website to test Flux Vector's document processing and semantic search capabilities with **real embeddings** running in your browser.

## Features

✅ **Real ML Models** - Uses actual Xenova/all-MiniLM-L6-v2 transformer model for embeddings
✅ **Document Upload** - Drag & drop or browse for PDF, TXT, MD, PNG, JPG files
✅ **OCR Support** - Extracts text from images using Tesseract.js
✅ **Semantic Search** - Find relevant content using natural language queries
✅ **Real-time Stats** - Track documents processed, chunks created, and searches performed
✅ **Console Log** - See detailed processing steps and results

## How to Use

### 1. Install Dependencies

```bash
cd tests/website-tester
npm install
```

### 2. Run the Dev Server

```bash
npm run dev
```

This will start a local server at `http://localhost:3000` and open it in your browser.

### 3. Test the System

1. **Upload Documents**
   - Click the upload area or drag & drop files
   - Supports: PDF, TXT, MD, PNG, JPG
   - Multiple files can be uploaded at once

2. **Process Documents**
   - Click "Process Documents" button
   - Watch the progress bar and console log
   - Documents will be chunked and embedded with ML models

3. **Search**
   - Enter a natural language query
   - Click "Search" or press Enter
   - View results sorted by semantic similarity

4. **View Statistics**
   - See total documents processed
   - Track chunks and indexed items
   - Monitor number of searches performed

## What This Tests

This website validates that the entire Flux Vector pipeline works correctly:

- ✅ Document extraction (text, PDF, images with OCR)
- ✅ Text chunking with overlap
- ✅ Real embedding generation using transformers.js
- ✅ HNSW vector indexing
- ✅ Semantic similarity search
- ✅ IndexedDB persistence (data persists across browser sessions)

## Example Workflows

### Test PDF Processing
1. Upload a PDF file
2. Process it
3. Search for content you know is in the PDF
4. Verify the results match expectations

### Test OCR
1. Upload an image with text (PNG/JPG)
2. Process it
3. Search for text visible in the image
4. Verify OCR extracted the text correctly

### Test Semantic Search
1. Upload multiple documents on different topics
2. Process all of them
3. Try natural language queries like:
   - "How do I configure authentication?"
   - "What are the performance metrics?"
   - "Explain the installation process"
4. Verify results are semantically relevant, not just keyword matches

## Troubleshooting

### Model Download Fails
- The first load downloads ~25MB ML model
- Requires internet connection
- Check browser console for errors

### Files Not Processing
- Check file format is supported
- Check browser console for errors
- See console log in the UI for details

### Search Not Working
- Ensure documents are processed first (button will be disabled until then)
- Check that embeddings were generated (see console log)

## Build for Production

```bash
npm run build
```

This creates a `dist/` folder with optimized production files.

## Notes

- **Data Persistence**: Uses IndexedDB, so data persists across browser sessions
- **Browser Support**: Requires modern browser with ES modules and WebAssembly
- **Performance**: First document takes longer (model loading), subsequent ones are faster
- **Memory**: Large documents or many uploads may consume significant browser memory

## Comparison with Unit Tests

| Aspect | Unit Tests (Mock) | Website Tester (Real) |
|--------|------------------|----------------------|
| Speed | Fast (seconds) | Slower (model download + processing) |
| ML Models | Mocked | Real transformers.js models |
| Embeddings | Fake | Real 384-dimension vectors |
| Environment | Node.js | Browser |
| Purpose | CI/CD, fast feedback | Manual validation, E2E testing |
| Network | Not required | Required (first load) |

Both approaches are valuable:
- **Unit tests** ensure code correctness quickly
- **Website tester** validates the entire system works in a real browser environment
