/**
 * Test setup file
 * Configures the test environment before tests run
 */

// Import fake-indexeddb to mock IndexedDB in Node.js
import 'fake-indexeddb/auto';

// Suppress Dexie's harmless database deletion warnings during tests
// These occur when multiple test instances try to delete the same database
// Dexie handles this gracefully by closing connections, but the warnings are noisy
const originalWarn = console.warn;
console.warn = (...args: any[]) => {
  const message = args[0]?.toString() || '';
  // Suppress Dexie's database deletion warnings
  if (
    message.includes('Another connection wants to delete database') ||
    message.includes('Closing db now to resume the delete request')
  ) {
    return; // Suppress this specific warning
  }
  // Allow all other warnings through
  originalWarn.apply(console, args);
};
