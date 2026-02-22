module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/services/whatsapp.js'
  ],
  setupFilesAfterSetup: [],
  testTimeout: 15000
};
