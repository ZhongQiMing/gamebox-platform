export type CsvValue = string | number | boolean | null | undefined;

/**
 * Excel/兼容表格会把字符串首部的 = + - @、TAB、CR 当作公式或指令。
 * 只处理字符串，避免把正常负数等数值列改成文本。
 */
export function csvCell(value: CsvValue): string {
  let raw = value == null ? '' : String(value);
  if (
    typeof value === 'string' &&
    (/^[\t\r]/.test(raw) || /^\s*[=+\-@]/.test(raw))
  ) {
    raw = `'${raw}`;
  }
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

export function csvRow(values: CsvValue[]): string {
  return values.map(csvCell).join(',');
}
