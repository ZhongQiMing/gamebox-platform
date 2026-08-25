/**
 * @gamebox/shared 入口
 * 只放"多端必须一致、且与 UI / 运行环境无关"的东西：
 *   enums       角色/状态/账本/游戏品类等枚举
 *   validators  纯函数校验（前端体验用，后端必须再校验一遍）
 *   format      金额/UID/时间 展示格式化
 *   types       与后端接口对应的 DTO / 契约
 * 禁止放：localStorage、DOM、fetch 实例、任何端特有逻辑。
 */
export * from './enums';
export * from './role-labels';
export * from './validators';
export * from './format';
export * from './money';
export * from './api-types';
export * from './fruit-machine';
export * from './bcbm';
export * from './instant-spin';
export * from './lottery-intervals';
export * from './max-win';
export * from './table-paytable';
export * from './table-round';
export * from './table-timing';
export * from './rebate-templates';
export * from './draw-display';
export * from './play-limits';
