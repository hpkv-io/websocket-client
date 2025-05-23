module.exports = {
  projects: [
    {
      displayName: 'node',
      testEnvironment: 'node',
      testMatch: [
        '**/tests/**/*.test.ts',
        '!**/tests/**/*.browser.test.ts', // Exclude browser tests
      ],
      transform: {
        '^.+\\.ts$': 'ts-jest',
      },
      preset: 'ts-jest',
    },
    {
      displayName: 'jsdom',
      testEnvironment: 'jsdom',
      testMatch: ['**/tests/**/*.browser.test.ts'], // Only browser tests
      transform: {
        '^.+\\.ts$': 'ts-jest',
      },
      preset: 'ts-jest',
    },
  ],
  moduleFileExtensions: ['ts', 'js'],
};
