/**
 * 资金集成测试：连真实 Postgres，跑前自动建 *_test 库并迁移。
 * 与默认 `pnpm test` 分开，避免没有数据库的环境（CI/构建机）跑不动。
 *
 * @type {import('jest').Config}
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.db.spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  globalSetup: '<rootDir>/test/db/global-setup.ts',
  testEnvironment: 'node',
  /* 并发用例本身要抢锁，超时给宽一点 */
  testTimeout: 60_000,
  clearMocks: true,
};
