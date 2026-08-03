import { BadRequestException } from '@nestjs/common';

function assertPositiveWeightMap(value: unknown, label: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException(`${label} 必须是对象`);
  }
  const weights = Object.values(value as Record<string, unknown>);
  if (weights.length === 0) throw new BadRequestException(`${label} 不能为空`);
  if (weights.some((weight) => typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0)) {
    throw new BadRequestException(`${label} 只能包含非负有限数`);
  }
  if ((weights as number[]).reduce((sum, weight) => sum + weight, 0) <= 0) {
    throw new BadRequestException(`${label} 总和必须大于 0`);
  }
}

export function validateGamePayTable(
  game: { code: string; category: string },
  payTable: unknown,
): void {
  if (game.category === 'SLOT' || game.category === 'TABLE') {
    if (!Array.isArray(payTable) || payTable.length === 0) {
      throw new BadRequestException('payTable 必须是非空数组');
    }
    for (const item of payTable) {
      if (!item || typeof item !== 'object') throw new BadRequestException('奖项配置无效');
      const row = item as Record<string, unknown>;
      if (typeof row.multiplier !== 'number' || row.multiplier < 0) {
        throw new BadRequestException('奖项倍率必须是非负数');
      }
      if (typeof row.weight !== 'number' || row.weight < 0) {
        throw new BadRequestException('奖项权重必须是非负数');
      }
    }
    assertPositiveWeightMap(
      Object.fromEntries(payTable.map((item, index) => [String(index), (item as { weight: number }).weight])),
      '奖项权重',
    );
    return;
  }

  if (game.category === 'ARCADE') {
    const config = payTable as { awardWeights?: unknown } | null;
    assertPositiveWeightMap(config?.awardWeights, 'awardWeights');
    return;
  }

  if (game.category === 'LOTTERY') {
    if (!payTable || typeof payTable !== 'object' || Array.isArray(payTable)) {
      throw new BadRequestException('彩票赔率表必须是对象');
    }
    const rows = Object.values(payTable as Record<string, unknown>);
    if (rows.length === 0) throw new BadRequestException('彩票赔率表不能为空');
    for (const row of rows) {
      const multiplier = typeof row === 'number'
        ? row
        : (row as { multiplier?: unknown } | null)?.multiplier;
      if (typeof multiplier !== 'number' || !Number.isFinite(multiplier) || multiplier <= 0) {
        throw new BadRequestException('彩票赔率必须是正数');
      }
    }
  }
}
