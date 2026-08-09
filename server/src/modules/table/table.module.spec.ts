/**
 * 牌桌 Socket.IO 网关默认必须是关的。
 *
 * 它推整桌快照（含别人的下注），而客户端早就全改走 HTTP /api/table/*。
 * 这条测试是防「以后有人顺手把它加回 providers」——那等于又开一个对外面。
 */
import 'reflect-metadata';

/** 按当前环境变量重新求值模块元数据 */
function loadProviderNames(): string[] {
  let names: string[] = [];
  jest.isolateModules(() => {
    /* eslint-disable-next-line @typescript-eslint/no-require-imports */
    const { TableModule } = require('./table.module') as { TableModule: object };
    const providers = (Reflect.getMetadata('providers', TableModule) ?? []) as Array<{
      name?: string;
    }>;
    names = providers.map((p) => p?.name ?? String(p));
  });
  return names;
}

describe('TableModule 网关开关', () => {
  const before = process.env.TABLE_WS_ENABLED;

  afterEach(() => {
    if (before === undefined) delete process.env.TABLE_WS_ENABLED;
    else process.env.TABLE_WS_ENABLED = before;
  });

  it('默认不注册 TableGateway', () => {
    delete process.env.TABLE_WS_ENABLED;
    const names = loadProviderNames();
    expect(names).toContain('TableService');
    expect(names).not.toContain('TableGateway');
  });

  it('值不是 1 时一律当关（含 true / yes 这类手滑写法）', () => {
    for (const v of ['0', 'true', 'yes', '', 'on']) {
      process.env.TABLE_WS_ENABLED = v;
      expect(loadProviderNames()).not.toContain('TableGateway');
    }
  });

  it('显式设成 1 才注册', () => {
    process.env.TABLE_WS_ENABLED = '1';
    expect(loadProviderNames()).toContain('TableGateway');
  });
});
