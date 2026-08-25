import { Controller, Get, Res, Header } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Response } from 'express'
import { Public } from '../../common/decorators/public.decorator'
import * as fs from 'fs'
import * as path from 'path'

/** 当前 APP 版本信息（后期迁移到数据库 + 后台配置） */
const APP_VERSION = {
  version: '1.0.0',
  versionCode: 1,
  forceUpdate: false,
  updateUrl: '',
  releaseNote: '官方安卓安装包',
  apkFileName: 'goldhub-v1.0.0.apk',
}

@Controller()
export class DownloadController {
  constructor(private cfg: ConfigService) {}

  /** GET /api/version — APP 版本检查接口（客户端启动时调用） */
  @Public()
  @Get('version')
  getVersion() {
    const base = this.cfg.get<string>('APP_BASE_URL') ?? 'http://localhost:3000'
    return { ...APP_VERSION, updateUrl: `${base}/api/download/apk` }
  }

  /** GET /api/download — 下载落地页 */
  @Public()
  @Get('download')
  @Header('Content-Type', 'text/html; charset=utf-8')
  downloadPage(@Res() res: Response) {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    )
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<title>金御汇 · 下载</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body,.stage{width:100%;height:100%;background:#000;overflow:hidden}
.stage{position:relative}
.poster{
  display:block;
  width:100%;
  height:100%;
  object-fit:fill;
  pointer-events:none;
}
.hotspot{
  position:absolute;
  left:11%;
  top:82.8%;
  width:78%;
  height:8.8%;
  z-index:1;
  cursor:pointer;
  -webkit-tap-highlight-color:transparent;
}
</style>
</head>
<body>
<div class="stage">
  <img class="poster" src="/public/download/poster.webp?v=11" alt="">
  <a class="hotspot" href="/api/download/apk" aria-label="立即下载"></a>
</div>
</body>
</html>`
    res.send(html)
  }

  /** GET /api/download/apk — 直接下载 APK 文件 */
  @Public()
  @Get('download/apk')
  downloadApk(@Res() res: Response) {
    const apkPath = path.join(process.cwd(), 'public', 'apk', APP_VERSION.apkFileName)
    if (!fs.existsSync(apkPath)) {
      return res.status(404).json({ code: 404, message: 'APK 文件暂未上传，请联系客服获取' })
    }
    res.download(apkPath, APP_VERSION.apkFileName)
  }
}
