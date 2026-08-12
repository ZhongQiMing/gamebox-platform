import { csvCell, csvRow } from './csv';

describe('CSV 单元格安全转义', () => {
  it.each(['=1+1', '+cmd', '-2+3', '@SUM(A1)', '\t=1'])(
    '阻断公式前缀 %p',
    (value) => {
      expect(csvCell(value)).toBe(`'${value}`);
    },
  );

  it('CR 前缀既阻断公式又按 CSV 规范包裹引号', () => {
    expect(csvCell('\r=1')).toBe('"\'\r=1"');
  });

  it('忽略前导空白后识别公式', () => {
    expect(csvCell('   =HYPERLINK("https://evil.example")')).toBe(
      '"\'   =HYPERLINK(""https://evil.example"")"',
    );
  });

  it('数值负数保持数值单元格', () => {
    expect(csvCell(-123.45)).toBe('-123.45');
  });

  it('同时执行公式防护与标准 CSV 引号转义', () => {
    expect(csvRow(['=1,2', '普通', 3])).toBe('"\'=1,2",普通,3');
  });
});
