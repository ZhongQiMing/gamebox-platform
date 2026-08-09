/**
 * 钉死客服在控制台上的可达接口集合。
 *
 * RolesGuard 的规则是「方法上没写 @Roles 就退到类级」，而类级又是兜底放行。
 * 一旦类级带上 CS，此后每加一个接口客服都自动能读——房间账本、周结对账单、
 * 经营报表、CSV 导出当初就是这么漏的，而且漏了不会有任何报错。
 *
 * 这里不测某一次修复，而是把「客服能打到哪些路由」整体锁住：
 * 新接口默认落在白名单外，谁给客服开口子都得先来改这份清单，改的时候自然会想一遍该不该开。
 */
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { ConsoleController } from './console.controller';

/**
 * 客服本职只有一件事：给系统派给自己的玩家上下分。这里每一条都要能说清为什么必须开。
 * 想加新条目前先问：客服不看这个数据，还能不能完成上下分？能，就不该加。
 */
const CS_ALLOWED = [
  'GET console/wallet/me', //            自己口袋里的额度
  'POST console/wallet/credit-player', // 给派单玩家上分（本职）
  'POST console/wallet/debit-player', //  给派单玩家下分（本职）
  'GET console/players/:id', //           派单玩家详情，服务层再验派单关系
  'GET console/agents/:userId/audit', //  自己的流水，服务层强制 userId === 本人
  'GET console/cs-staff/me', //           自己的额度与佣金汇总
  'GET console/cs-staff/wage/bills', //   自己的佣金账单
  'PATCH console/cs-staff/:id', //        自己切接单/休息
].sort();

const VERB: Record<number, string> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.PATCH]: 'PATCH',
};

interface Route {
  key: string;
  roles: string[] | undefined;
}

function routesOf(controller: new (...args: never[]) => unknown): Route[] {
  const base = Reflect.getMetadata(PATH_METADATA, controller) as string;
  const proto = controller.prototype as Record<string, unknown>;
  const routes: Route[] = [];
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === 'constructor') continue;
    const handler = proto[name];
    if (typeof handler !== 'function') continue;
    const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
    if (path === undefined) continue;
    const verb = VERB[Reflect.getMetadata(METHOD_METADATA, handler) as number] ?? '?';
    /* 方法级 @Roles 覆盖类级，不合并——与 RolesGuard 的 getAllAndOverride 一致 */
    const roles = (Reflect.getMetadata(ROLES_KEY, handler) ??
      Reflect.getMetadata(ROLES_KEY, controller)) as string[] | undefined;
    routes.push({ key: `${verb} ${[base, path].filter((p) => p && p !== '/').join('/')}`, roles });
  }
  return routes;
}

describe('ConsoleController 客服可达面', () => {
  const routes = routesOf(ConsoleController);

  it('能解析出全部路由（解析挂了会让下面的断言假通过）', () => {
    expect(routes.length).toBeGreaterThan(50);
    expect(routes.every((r) => r.roles?.length)).toBe(true);
  });

  it('客服可达的接口与白名单逐条一致', () => {
    const reachable = routes
      .filter((r) => r.roles?.includes('CS'))
      .map((r) => r.key)
      .sort();
    expect(reachable).toEqual(CS_ALLOWED);
  });

  it('房间账本 / 周结 / 报表 / 导出一律不对客服开放', () => {
    const leaky = routes.filter(
      (r) =>
        r.roles?.includes('CS') &&
        /rooms|week-settle|reports|dashboard|export|logs/.test(r.key),
    );
    expect(leaky.map((r) => r.key)).toEqual([]);
  });

  it('类级默认角色不含 CS——否则新接口会自动对客服开放', () => {
    const classRoles = Reflect.getMetadata(ROLES_KEY, ConsoleController) as string[];
    expect(classRoles).not.toContain('CS');
  });
});
