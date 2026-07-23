module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@fiscal-digital/engine$': '<rootDir>/../engine/src/index.ts',
    '^@fiscal-digital/contracts$': '<rootDir>/../contracts/src/index.ts',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          types: ['node', 'jest'],
        },
      },
    ],
  },
}
