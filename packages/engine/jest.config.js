module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@fiscal-digital/engine$': '<rootDir>/src/index.ts',
  },
}
