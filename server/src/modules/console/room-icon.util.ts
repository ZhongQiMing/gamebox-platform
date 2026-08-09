import { BadRequestException } from '@nestjs/common';
import { isRealImage } from '../../common/utils/image-magic';

/** 未自定义时前端/接口回落用的默认房间图 */
export const DEFAULT_ROOM_ICON = '/images/rooms/default-room.png';

/**
 * 把 data URL 存成房间图标文件，返回可公开访问的路径。
 * 只接受真图片；禁止外链。
 */
export async function saveRoomIconFromDataUrl(
  roomId: string,
  dataUrl: string,
): Promise<string> {
  const m = String(dataUrl || '').match(
    /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/i,
  );
  if (!m) throw new BadRequestException('请上传 JPG / PNG / WEBP 图片');
  const extRaw = m[1].toLowerCase() === 'jpg' ? 'jpeg' : m[1].toLowerCase();
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length < 1024) throw new BadRequestException('图片太小');
  if (buf.length > 800 * 1024) throw new BadRequestException('图片请小于 800KB');
  if (!isRealImage(buf)) throw new BadRequestException('请上传 JPG / PNG / WEBP 图片');

  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const dir = path.join(process.cwd(), 'uploads', 'rooms');
  await fs.mkdir(dir, { recursive: true });
  const file = `${roomId}.${extRaw === 'jpeg' ? 'jpg' : extRaw}`;
  await fs.writeFile(path.join(dir, file), buf);
  return `/uploads/rooms/${file}?t=${Date.now()}`;
}

export function displayRoomIcon(icon: string | null | undefined): string {
  const s = String(icon || '').trim();
  return s || DEFAULT_ROOM_ICON;
}
