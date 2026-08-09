/**
 * 只认真实的 JPG / PNG / WEBP 文件头。
 *
 * MIME 是客户端说的，改 data URL 前缀就能把任意内容当图片传上来。
 * 上传目录是对外可访问的静态目录，放进去的东西迟早会被人直接请求。
 */
export function isRealImage(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  /* JPEG: FF D8 FF */
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  /* PNG: 89 50 4E 47 0D 0A 1A 0A */
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return true;
  }
  /* WEBP: RIFF....WEBP */
  return (
    buf.subarray(0, 4).toString('latin1') === 'RIFF'
    && buf.subarray(8, 12).toString('latin1') === 'WEBP'
  );
}
