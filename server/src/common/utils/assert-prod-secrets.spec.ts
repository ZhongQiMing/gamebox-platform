import { randomBytes } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { assertProdSecrets } from './assert-prod-secrets';

function cfg(values: Record<string, string>): ConfigService {
  return { get: (k: string) => values[k] } as unknown as ConfigService;
}

function expectRejected(secret: string) {
  expect(() => assertProdSecrets(cfg({ JWT_SECRET: secret }), true)).toThrow(/JWT_SECRET/);
}

function expectAccepted(secret: string) {
  expect(() => assertProdSecrets(cfg({ JWT_SECRET: secret }), true)).not.toThrow();
}

describe('生产密钥门禁', () => {
  it('拒绝占位串与短串', () => {
    expectRejected('');
    expectRejected('CHANGE_ME_TO_A_LONG_RANDOM_STRING');
    expectRejected('short');
    expectRejected('a'.repeat(64));
  });

  /**
   * 这条是上线阻断项：仓库里的本地开发密钥有 39 位、字符够杂，
   * 只按长度和重复字符判会直接放行，复制 .env 上线等于公开签发权。
   */
  it('拒绝仓库里的本地开发密钥', () => {
    expectRejected('gamebox_dev_jwt_secret_local_only_2026');
    expectRejected('my_super_long_development_secret_for_testing_only');
    expectRejected('example_secret_value_that_is_long_enough_1234');
  });

  it('放行真随机串', () => {
    expectAccepted(randomBytes(32).toString('hex'));
    expectAccepted(randomBytes(48).toString('base64url'));
  });

  it('开发环境只告警不抛', () => {
    expect(() => assertProdSecrets(cfg({ JWT_SECRET: 'dev' }), false)).not.toThrow();
  });
});
