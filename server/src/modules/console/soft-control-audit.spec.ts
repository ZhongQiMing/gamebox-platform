import { Reflector } from '@nestjs/core';
import { SoftControlAuditService } from './soft-control-audit.service';
import { ConsoleController } from './console.controller';
import { SOFT_CONTROL_ACTIONS, listActionOptions } from '../admin/admin-log.labels';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';

/**
 * 软控留痕的两条纪律：
 *  1. 每一次「放弃自然结果」都要留下可审计的痕迹，且能回答「本来会开什么、为什么改」
 *  2. 这些痕迹只有 ADMIN 能看，其他任何成员一点都不能看见
 */
describe('软控介入留痕', () => {
  describe('写入', () => {
    function makeService() {
      const created: Array<Record<string, unknown>> = [];
      const svc = Object.create(SoftControlAuditService.prototype) as SoftControlAuditService;
      (svc as unknown as { logger: unknown }).logger = {
        log: jest.fn(), warn: jest.fn(), error: jest.fn(),
      };
      (svc as unknown as Record<string, unknown>).prisma = {
        softControlAudit: {
          create: jest.fn(async (a: { data: Record<string, unknown> }) => {
            created.push(a.data);
            return a.data;
          }),
        },
      };
      return { svc, created };
    }

    const base = {
      category: 'table' as const,
      gameCode: 'baccarat',
      refNo: 'BJL20260820-0001',
      reason: 'period+bias',
      tries: 8,
      naturalDigest: 'player 庄:散牌 闲:对子',
      adoptedDigest: 'banker 庄:金花 闲:散牌',
      stake: 120_000,
      estPayout: 30_000,
    };

    it('留下的痕迹要能回答「本来会开什么、为什么改」', async () => {
      const { svc, created } = makeService();
      await svc.record(base);
      expect(created).toHaveLength(1);
      const row = created[0]!;
      expect(row.reason).toBe('period+bias');
      expect(row.naturalDigest).toBe('player 庄:散牌 闲:对子');
      expect(row.adoptedDigest).toBe('banker 庄:金花 闲:散牌');
      expect(row.tries).toBe(8);
      expect(String(row.stake)).toBe('120000');
      expect(String(row.estPayout)).toBe('30000');
    });

    it('缺局号不写入，避免留下对不上局的孤儿痕迹', async () => {
      const { svc, created } = makeService();
      await svc.record({ ...base, refNo: '   ' });
      expect(created).toHaveLength(0);
    });

    it('同一局重复写入按已记过处理（幂等）', async () => {
      const svc = Object.create(SoftControlAuditService.prototype) as SoftControlAuditService;
      (svc as unknown as { logger: unknown }).logger = {
        log: jest.fn(), warn: jest.fn(), error: jest.fn(),
      };
      const dup = Object.assign(new Error('dup'), { code: 'P2002' });
      Object.setPrototypeOf(
        dup,
        // 模拟 PrismaClientKnownRequestError 的原型链
        Object.getPrototypeOf(dup),
      );
      (svc as unknown as Record<string, unknown>).prisma = {
        softControlAudit: { create: jest.fn().mockRejectedValue(dup) },
      };
      /* 不该往外抛：留痕失败绝不能拖累开奖 */
      await expect(svc.record(base)).resolves.toBeUndefined();
    });

    it('留痕写库失败也不能抛到开奖链路上', async () => {
      const svc = Object.create(SoftControlAuditService.prototype) as SoftControlAuditService;
      const error = jest.fn();
      (svc as unknown as { logger: unknown }).logger = { log: jest.fn(), warn: jest.fn(), error };
      (svc as unknown as Record<string, unknown>).prisma = {
        softControlAudit: { create: jest.fn().mockRejectedValue(new Error('db down')) },
      };
      await expect(svc.record(base)).resolves.toBeUndefined();
      /* 但必须留下噪音让人看见 */
      expect(error).toHaveBeenCalled();
    });
  });

  describe('只有 ADMIN 能看', () => {
    const reflector = new Reflector();

    it('两个留痕查询接口都是 ADMIN 专属', () => {
      const proto = ConsoleController.prototype as unknown as Record<string, unknown>;
      for (const method of ['softControlAudit', 'softControlAuditSummary']) {
        const handler = proto[method];
        expect(typeof handler).toBe('function');
        const roles = reflector.get<string[]>(ROLES_KEY, handler as never);
        expect(roles).toEqual(['ADMIN']);
      }
    });

    it('控奖类操作日志被列入「仅 ADMIN」名单', () => {
      expect(SOFT_CONTROL_ACTIONS).toContain('CONTROL_GLOBAL_SOFT');
      expect(SOFT_CONTROL_ACTIONS).toContain('CONTROL_SOFT_BIAS');
      expect(SOFT_CONTROL_ACTIONS).toContain('CONTROL_CREATE');
      expect(SOFT_CONTROL_ACTIONS).toContain('CONTROL_STATUS');
      expect(SOFT_CONTROL_ACTIONS).toContain('CONTROL_EXHAUSTED');
      expect(SOFT_CONTROL_ACTIONS).toContain('CONTROL_DELETE');
      /* 别把无关动作误伤进来 */
      expect(SOFT_CONTROL_ACTIONS).not.toContain('ROOM_WEEK_SETTLE');
    });

    it('非 ADMIN 的日志筛选项里看不到控奖分组', () => {
      for (const role of ['BRANCH', 'GENERAL', 'AGENT', 'PROXY', 'CS']) {
        const groups = new Set(listActionOptions(role).map((o) => o.group));
        expect(groups.has('控奖')).toBe(false);
      }
      expect(new Set(listActionOptions('ADMIN').map((o) => o.group)).has('控奖')).toBe(true);
    });
  });
});
