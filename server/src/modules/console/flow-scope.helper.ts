/**
 * 三方经营流水口径：同一批注，管理 / 总代 / 代理各看自己那一截。
 *
 * 底数只统计三个桶，谁都从这三个桶里取：
 * - flown   飞上台（平台坐庄）
 * - agentFly 代理飞出去的（上台 + 飞到总代）
 * - all     全部（再加上代理自己坐庄）
 *
 * 结账不走这里：总表只认 flown，房间单只认 agentFly。
 */
export type FlowViewerSide = 'PLATFORM' | 'GENERAL' | 'AGENT';

export type FlowBuckets = {
  /** 飞上台 */
  flown: number;
  /** 代理飞盘：上台 + 飞到总代 */
  agentFly: number;
  /** 含代理自己坐庄 */
  all: number;
};

export type FlowView = {
  /** 页面主数 */
  total: number;
  /** 「飞」那一栏 */
  flying: number;
  /** 「关」那一栏；管理不显示，恒为 0 */
  closed: number;
};

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * 三级账本各管各的：每一级只看「我接到的单」，再拆成「我飞给上家的」和「我自己坐庄的」。
 * 上家怎么处理我飞上去的单，不进我的账。
 *
 * 由此得到一条贯穿链路的等式——**每一级飞出去的，正好是上一级接到的**：
 *
 *   代理 total=全部        flying=代理飞出去的 ─┐
 *   总代 total=代理飞出去的 ←──────────────────┘  flying=飞上台的 ─┐
 *   平台 total=飞上台的    ←───────────────────────────────────┘
 *
 * 结账口径与此吻合：房间单收代理 flying（agentFly），总代表收总代 flying（flown）。
 *
 * 平台是例外：顶层没有上家，flying 栏在管理端标的是「飞盘流水」＝飞上来的那批，
 * 语义与下面两级相反，closed 恒为 0（下级关盘不进平台账，也不该占管理端的栏位）。
 */
export function flowViewFor(side: FlowViewerSide, b: FlowBuckets): FlowView {
  const flown = round2(b.flown);
  const agentFly = round2(b.agentFly);
  const all = round2(b.all);
  if (side === 'PLATFORM') {
    /* 顶层没有上家。flying 栏在管理端标的是「飞盘流水」＝飞上来的那批，关盘与平台无关 */
    return { total: flown, flying: flown, closed: 0 };
  }
  if (side === 'GENERAL') {
    /* 代理自己关盘的那截是代理的账，不进总代的表 */
    return { total: agentFly, flying: flown, closed: round2(agentFly - flown) };
  }
  return { total: all, flying: agentFly, closed: round2(all - agentFly) };
}

export function flowViewerSide(opts: {
  isPlatformSide: boolean;
  isGeneralSide: boolean;
}): FlowViewerSide {
  if (opts.isPlatformSide) return 'PLATFORM';
  if (opts.isGeneralSide) return 'GENERAL';
  return 'AGENT';
}
