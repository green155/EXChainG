/**
 * Two projects, because they need different runtimes:
 *  - "domain" runs the pure rate/format/source logic on plain Node, which keeps
 *    it fast and free of React Native's native shims.
 *  - "components" uses the jest-expo preset so React Native components mount.
 */
module.exports = {
  projects: [
    {
      displayName: 'domain',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/__tests__/**/*.test.ts'],
      transform: {
        '^.+\\.[jt]sx?$': ['babel-jest', { caller: { platform: 'node', bundler: 'metro' } }],
      },
    },
    {
      displayName: 'components',
      preset: 'jest-expo',
      testMatch: ['<rootDir>/__tests__/**/*.test.tsx'],
      setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
    },
  ],
  collectCoverageFrom: ['src/**/*.{ts,tsx}'],
};
