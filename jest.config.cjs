module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  collectCoverageFrom: [
    'embeddings/**/*.ts',
    'document-processing/**/*.ts',
    'mememo/**/*.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
  ],
  coverageDirectory: 'coverage',
  verbose: true,
  testTimeout: 30000,
  
  // Transform configuration (new ts-jest format)
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        module: 'ESNext',
        moduleResolution: 'node',
        target: 'ES2020',
        lib: ['ES2020', 'DOM'],
        skipLibCheck: true,
      }
    }]
  },
  
  // Transform ES modules from node_modules
  transformIgnorePatterns: [
    'node_modules/(?!(d3-random|@huggingface)/)'
  ],
  
  // Setup fake-indexeddb
  setupFiles: ['<rootDir>/tests/setup.ts'],
  
  // Module name mapper for ES modules
  moduleNameMapper: {
    '^d3-random$': '<rootDir>/tests/mocks/d3-random-mock.ts',
    '^uuid$': '<rootDir>/tests/mocks/uuid-mock.ts',
  },
};
