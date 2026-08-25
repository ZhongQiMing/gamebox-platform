import { fundLogScopeSql, quotaSummaryScopeSql } from './admin-log-sum.helper';

describe('fundLogScopeSql', () => {
  it('总监只看自己经手的额度与调额', () => {
    const sql = fundLogScopeSql({
      userId: 'branch-1',
      agentRootId: 'branch-1',
      staffIds: [],
      operatorIds: [],
      role: 'BRANCH',
    });
    expect(sql.strings.join(' ')).toContain('ROOM_CREDIT_LIMIT_BUMP');
    expect(sql.strings.join(' ')).toContain('QUOTA_SELL');
  });

  it('总代包含合同额度调整', () => {
    const sql = fundLogScopeSql({
      userId: 'g-1',
      agentRootId: 'g-1',
      staffIds: [],
      operatorIds: [],
      role: 'GENERAL',
    });
    expect(sql.strings.join(' ')).toContain('GENERAL_CREDIT_LIMIT_BUMP');
  });

  it('总监额度汇总只看自己经手的进出', () => {
    const sql = quotaSummaryScopeSql({ userId: 'branch-1', role: 'BRANCH' });
    expect(sql.strings.join(' ')).toContain('operatorId');
    expect(sql.strings.join(' ')).not.toContain('target');
  });

  it('房间代理按操作人名单或 detail.agentUserId 归因', () => {
    const sql = fundLogScopeSql({
      userId: 'a-1',
      agentRootId: 'a-1',
      staffIds: ['a-1', 'p-1'],
      operatorIds: ['a-1'],
      role: 'AGENT',
    });
    const text = sql.strings.join(' ');
    expect(text).toContain('CONSOLE_CREDIT');
    expect(text).toContain('agentUserId');
  });
});
