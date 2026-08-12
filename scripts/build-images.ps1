<#
.SYNOPSIS
  本机构建生产镜像，打上不可变版本号，压成可上传的 tar 包。

.DESCRIPTION
  镜像标签用「日期-时刻-提交号」而不是 latest。

  latest 是同名覆盖：服务器 docker load 一个同样叫 latest 的新镜像，
  Docker 会把标签从旧镜像上摘下来贴到新的，旧镜像变成没名字的 <none>，
  启动不了，下次清理就没了 —— 这就是「上线出事没法回退」的根因。

  带版本号后服务器上能同时存好几套，回滚只是改 .env.prod 里一行再重启。

  两个镜像强制同版本号：前后端分开回滚会出现「新前端调旧接口」，
  比不回滚还糟。

.EXAMPLE
  pwsh scripts/build-images.ps1 -PlayerOrigin https://app.example.com -GameOrigin https://games.example.com
  pwsh scripts/build-images.ps1 -OutDir D:\deploy
#>
[CmdletBinding()]
param(
  # tar 包输出目录，默认仓库根的 dist-images/（已在 .gitignore 里）
  [string]$OutDir,
  [string]$PlayerOrigin = $env:PLAYER_ORIGIN,
  [string]$GameOrigin = $env:GAME_ORIGIN,
  [switch]$AllowDirty,
  [string]$DirtyReason
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Fail($msg) { Write-Host "`n[构建失败] $msg" -ForegroundColor Red; exit 1 }
function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

foreach ($entry in @{ PLAYER_ORIGIN = $PlayerOrigin; GAME_ORIGIN = $GameOrigin }.GetEnumerator()) {
  if (-not $entry.Value -or $entry.Value -notmatch '^https://[^/]+$') {
    Fail "$($entry.Key) 必须是无路径的 HTTPS Origin，例如 https://app.example.com"
  }
}
if ($PlayerOrigin -eq $GameOrigin) { Fail 'PLAYER_ORIGIN 与 GAME_ORIGIN 必须不同' }

docker version --format '{{.Server.Version}}' > $null 2>&1
if ($LASTEXITCODE -ne 0) { Fail 'Docker 没在运行，先打开 Docker Desktop' }

# ── 版本号 ────────────────────────────────────────────────
# 带到秒是为了绝对唯一：同一个提交上反复构建（改配置、试参数）很常见，
# 只用日期+提交号会撞车，撞车就又变成同名覆盖，回到 latest 的老问题。
$sha = (& git rev-parse --short=7 HEAD 2>$null)
if ($LASTEXITCODE -ne 0 -or -not $sha) { Fail '不在 git 仓库里，或仓库还没有提交' }
$sha = $sha.Trim()

$version = "$(Get-Date -Format 'yyyyMMdd-HHmmss')-$sha"
$dirty = @(& git status --porcelain).Count -gt 0
if ($dirty -and -not $AllowDirty) {
  Fail '工作区有未提交改动，正式构建已拒绝。仅紧急情况可显式使用 -AllowDirty -DirtyReason ''原因''。'
}
if ($dirty -and [string]::IsNullOrWhiteSpace($DirtyReason)) {
  Fail '使用 -AllowDirty 时必须同时提供非空 -DirtyReason，原因会写入完整性清单。'
}
if ($dirty) { $version = "$version-dirty-emergency" }

# 仓库根文件是唯一权威来源。部署目录副本只允许由构建流程生成，并做字节级对账。
$composeSource = Join-Path $repoRoot 'docker-compose.prod.images.yml'
$composeCopy = Join-Path $repoRoot 'gamebox-deploy-config\docker-compose.prod.images.yml'
Copy-Item -LiteralPath $composeSource -Destination $composeCopy -Force
$sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $composeSource).Hash.ToLowerInvariant()
$copyHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $composeCopy).Hash.ToLowerInvariant()
if ($sourceHash -ne $copyHash) { Fail '部署 Compose 副本生成后仍与根文件不一致' }

if (-not $OutDir) { $OutDir = Join-Path $repoRoot 'dist-images' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$tarPath = Join-Path $OutDir "gamebox-images-$version.tar"
$gzPath = "$tarPath.gz"
$manifestPath = Join-Path $OutDir "gamebox-images-$version.manifest"

Write-Host "版本号  $version"
Write-Host "输出到  $gzPath"
Write-Host "玩家域  $PlayerOrigin"
Write-Host "游戏域  $GameOrigin"
if ($dirty) {
  Write-Host '紧急覆盖：正在构建 dirty 工作区；标签与清单均会永久记录。' -ForegroundColor Yellow
  Write-Host "覆盖原因：$DirtyReason" -ForegroundColor Yellow
}

# ── 构建 ──────────────────────────────────────────────────
# 两个 Dockerfile 的构建上下文都是仓库根：server 要 packages/shared 和根 lockfile，
# web 要根级 games-assets
Step "构建 server 镜像"
docker build -f server/Dockerfile -t "gamebox-server:$version" -t 'gamebox-server:latest' .
if ($LASTEXITCODE -ne 0) { Fail 'server 镜像构建失败' }

Step "构建 web 镜像（含玩家端 + 管理后台，要跑两次类型检查，比较慢）"
docker build -f client-app/Dockerfile `
  --build-arg "PLAYER_ORIGIN=$PlayerOrigin" `
  --build-arg "GAME_ORIGIN=$GameOrigin" `
  -t "gamebox-web:$version" -t 'gamebox-web:latest' .
if ($LASTEXITCODE -ne 0) { Fail 'web 镜像构建失败' }

# ── 打包 ──────────────────────────────────────────────────
# 只导出带版本号的标签，不导出 latest：服务器上留着 latest 只会让人分不清
# 到底跑的哪一版，而 compose 已经改成认 GAMEBOX_VERSION 了
Step '导出镜像'
docker save -o $tarPath "gamebox-server:$version" "gamebox-web:$version"
if ($LASTEXITCODE -ne 0) { Fail '镜像导出失败' }

Step '压缩（docker save 出来的是未压缩层，压一下通常能小一半）'
$in = [System.IO.File]::OpenRead($tarPath)
$out = [System.IO.File]::Create($gzPath)
$gzip = New-Object System.IO.Compression.GZipStream($out, [System.IO.Compression.CompressionLevel]::Optimal)
try { $in.CopyTo($gzip) } finally { $gzip.Dispose(); $out.Dispose(); $in.Dispose() }
Remove-Item $tarPath

$sizeMb = [math]::Round((Get-Item $gzPath).Length / 1MB, 1)
$archiveHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $gzPath).Hash.ToLowerInvariant()
$serverImageId = (& docker image inspect --format '{{.Id}}' "gamebox-server:$version").Trim()
if ($LASTEXITCODE -ne 0 -or -not $serverImageId) { Fail '无法读取 server 镜像 ID' }
$webImageId = (& docker image inspect --format '{{.Id}}' "gamebox-web:$version").Trim()
if ($LASTEXITCODE -ne 0 -or -not $webImageId) { Fail '无法读取 web 镜像 ID' }
$commit = (& git rev-parse HEAD).Trim()
$dirtyFlag = if ($dirty) { '1' } else { '0' }
$reasonForManifest = if ($dirty) { $DirtyReason -replace "(`r|`n)", ' ' } else { '' }
@(
  'manifest_version=1'
  "version=$version"
  "git_commit=$commit"
  "dirty=$dirtyFlag"
  "dirty_reason=$reasonForManifest"
  "archive_sha256=$archiveHash"
  "server_image_id=$serverImageId"
  "web_image_id=$webImageId"
  "compose_sha256=$sourceHash"
) | Set-Content -LiteralPath $manifestPath -Encoding ASCII

Write-Host "`n构建完成：$version（$sizeMb MB）" -ForegroundColor Green
Write-Host "完整性清单：$manifestPath"
Write-Host @"

下一步（把 <服务器> 换成你的地址）：

  scp "$gzPath" "$manifestPath" root@<服务器>:/tmp/
  scp docker-compose.prod.images.yml scripts/*-on-server.sh scripts/verify-runtime-security.sh root@<服务器>:/tmp/
  ssh root@<服务器> "PUBLIC_BASE_URL=$PlayerOrigin ADMIN_BASE_URL=https://admin.example.com GAME_BASE_URL=$GameOrigin bash /tmp/deploy-on-server.sh"

部署脚本会自己从 tar 包里认出版本号，健康检查不过会自动退回上一版。
"@
