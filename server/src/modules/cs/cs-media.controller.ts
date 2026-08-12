import {
  Controller,
  Get,
  Param,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CsService } from './cs.service';

@Controller('cs/media')
export class CsMediaController {
  constructor(private readonly service: CsService) {}

  @Get(':id')
  async open(
    @CurrentUser() actor: { id: string; role: string },
    @Param('id') id: string,
    @Res() response: Response,
  ) {
    const media = await this.service.openMedia(actor, id);
    response.set({
      'Cache-Control': 'private, no-store, max-age=0',
      Pragma: 'no-cache',
      'Content-Type': media.mimeType,
      'Content-Length': String(media.sizeBytes),
      'Content-Disposition': `inline; filename="${media.filename}"`,
    });
    const stream = createReadStream(media.path);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
  }
}
