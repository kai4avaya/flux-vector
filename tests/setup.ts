/**
 * Test setup file
 * Configures the test environment before tests run
 */

// Import fake-indexeddb to mock IndexedDB in Node.js
import 'fake-indexeddb/auto';

// Suppress console logs during tests (optional)
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
//   warn: jest.fn(),
// };
