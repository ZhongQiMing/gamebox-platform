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
  updateUrl: '',           // 动态填充
  releaseNote: '首个正式版本，包含登录注册与游戏大厅',
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

  /** GET /api/download — 下载落地页（浏览器访问时返回 HTML） */
  @Public()
  @Get('download')
  @Header('Content-Type', 'text/html; charset=utf-8')
  downloadPage(@Res() res: Response) {
    const base = this.cfg.get<string>('APP_BASE_URL') ?? 'http://localhost:3000'
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>金御汇 · 下载</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0700;color:#fff;font-family:'PingFang SC',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.card{background:linear-gradient(160deg,#1a1204,#0d0902);border:1px solid rgba(200,160,40,.4);border-radius:20px;padding:40px 32px;text-align:center;max-width:380px;width:100%}
.logo{font-size:48px;margin-bottom:8px}
h1{color:#e8c032;font-size:26px;letter-spacing:.2em;margin-bottom:6px}
.sub{color:rgba(255,255,255,.5);font-size:13px;letter-spacing:.1em;margin-bottom:32px}
.divider{border:none;border-top:1px solid rgba(200,160,40,.25);margin:24px 0}
.btn{display:block;width:100%;padding:14px;border-radius:12px;font-size:16px;font-weight:700;text-decoration:none;margin-bottom:12px;letter-spacing:.1em}
.btn-android{background:linear-gradient(135deg,#c8960a,#e8c032);color:#1a1000}
.btn-ios{background:rgba(255,255,255,.07);border:1px solid rgba(200,160,40,.4);color:#e8c032}
.note{color:rgba(255,255,255,.35);font-size:12px;line-height:1.6;margin-top:16px}
.ver{color:rgba(200,160,40,.5);font-size:11px;margin-top:20px}
</style>
</head>
<body>
<div class="card">
  <div class="logo">🏆</div>
  <h1>金 御 汇</h1>
  <div class="sub">G O L D &nbsp;·&nbsp; H U B</div>
  <a href="${base}/api/download/apk" class="btn btn-android">⬇ 安卓下载 APK</a>
  <a href="#" class="btn btn-ios" onclick="alert('iOS 版即将上线，敬请期待');return false">🍎 iOS（敬请期待）</a>
  <hr class="divider">
  <div class="note">
    安装前请在手机设置中开启<br>「允许安装未知来源应用」
  </div>
  <div class="ver">v${APP_VERSION.version} · ${APP_VERSION.releaseNote}</div>
</div>
</body>
</html>`
    res.send(html)
  }

  /** GET /api/download/apk — 直接下载 APK 文件 */
  @Public()
  @Get('download/apk')
  downloadApk(@Res() res: Response) {
    // APK 放在 server/public/apk/ 目录下
    const apkPath = path.join(process.cwd(), 'public', 'apk', APP_VERSION.apkFileName)
    if (!fs.existsSync(apkPath)) {
      return res.status(404).json({ code: 404, message: 'APK 文件暂未上传，请联系客服获取' })
    }
    res.download(apkPath, APP_VERSION.apkFileName)
  }
}
