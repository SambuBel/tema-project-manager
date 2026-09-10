/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  moduleNameMapper: {
    '^@tema/shared-types$': '<rootDir>/../../../packages/shared-types/src/index.ts',
  },
};
