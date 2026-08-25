<#
.SYNOPSIS
  出一个连本机开发服务器的安卓调试包，装手机上真机体验用。

.DESCRIPTION
  这不是上架包，是个空壳：页面实时从你电脑的 Vite 拉，改代码不用重新打包。
  代价是电脑必须开着 dev:server + dev:app，手机要和电脑同一个局域网。

  局域网 IP 是编译进安装包的，换 WiFi 或者路由器重新分配地址后旧包就连不上，
  得重跑这个脚本。想一劳永逸就在路由器上给这台机器做 DHCP 静态绑定。

  两个容易踩的坑，脚本都处理了：

  1. cap sync 会把 client-app/dist 整个塞进 APK，而壳包模式下 WebView 压根不读
     这些本地文件。全量 dist 有 300MB 左右，白白让包大两个数量级。所以同步前把
     dist 换成只含 index.html 的占位目录（Capacitor 只校验这个文件在不在），
     结束再换回来 —— 放在 finally 里，中途报错也不会把你的 dist 弄丢。

  2. 打完调试包，安卓工程里残留的 capacitor.config.json 还指着你的电脑。
     之后直接出正式包的话玩家装上就是白屏。脚本最后会提醒，但别依赖提醒，
     正式出包一律重跑 app:release。

.EXAMPLE
  pwsh scripts/build-debug-apk.ps1
  pwsh scripts/build-debug-apk.ps1 -HostIp 192.168.1.23
  pwsh scripts/build-debug-apk.ps1 -Emulator          # 安卓模拟器用 10.0.2.2
#>
[CmdletBinding()]
param(
  # 不给就自动探测；探测不准或有多张网卡时手动指定
  [string]$HostIp,
  # 模拟器里 10.0.2.2 是固定指向宿主机的地址，跟局域网 IP 无关
  [switch]$Emulator,
  [int]$Port = 5173,
  # APK 复制到哪，默认桌面
  [string]$OutDir = [Environment]::GetFolderPath('Desktop')
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$clientApp = Join-Path $repoRoot 'client-app'
$androidDir = Join-Path $clientApp 'android'
$distDir = Join-Path $clientApp 'dist'
$stashDir = Join-Path $clientApp 'dist.full'

function Resolve-LanIp {
  # 只认有默认网关的物理网卡：WSL / Hyper-V / 代理软件的虚拟网卡也有 IPv4，
  # 但手机路由不过去，选中了就是白屏
  $candidates = Get-NetIPConfiguration |
    Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } |
    Where-Object { $_.InterfaceAlias -notmatch 'vEthernet|WSL|Hyper-V|Loopback|VPN|Mihomo|Clash|TAP|VirtualBox|VMware' }

  $ip = $candidates |
    Sort-Object { if ($_.InterfaceAlias -match 'Wi-Fi|WLAN|无线') { 0 } else { 1 } } |
    ForEach-Object { $_.IPv4Address.IPAddress } |
    Select-Object -First 1

  if (-not $ip) {
    throw '探测不到局域网 IP。用 -HostIp 手动指定，例如 -HostIp 192.168.1.23'
  }
  return $ip
}

if ($Emulator) {
  $target = '10.0.2.2'
} elseif ($HostIp) {
  $target = $HostIp
} else {
  $target = Resolve-LanIp
}

$devUrl = "http://${target}:${Port}"
Write-Host "开发服务器地址：$devUrl" -ForegroundColor Cyan

if (-not (Test-Path $distDir)) {
  New-Item -ItemType Directory -Force -Path $distDir | Out-Null
}

$stashed = $false
try {
  if (Test-Path $stashDir) {
    throw "$stashDir 已存在，可能是上次运行中断留下的。先确认里面是不是你的 dist，手动处理后再跑。"
  }
  Move-Item $distDir $stashDir
  $stashed = $true

  New-Item -ItemType Directory -Force -Path $distDir | Out-Null
  Set-Content -Path (Join-Path $distDir 'index.html') `
    -Value '<!doctype html><meta charset="utf-8"><title>dev shell</title>' -Encoding utf8

  Write-Host '同步 Capacitor 工程...' -ForegroundColor Cyan
  Push-Location $clientApp
  try {
    $env:CAP_DEV_URL = $devUrl
    pnpm exec cap sync android
    if ($LASTEXITCODE -ne 0) { throw "cap sync 失败（退出码 $LASTEXITCODE）" }
  } finally {
    Remove-Item Env:\CAP_DEV_URL -ErrorAction SilentlyContinue
    Pop-Location
  }

  Write-Host '构建 APK...' -ForegroundColor Cyan
  Push-Location $androidDir
  try {
    & (Join-Path $androidDir 'gradlew.bat') assembleDebug
    if ($LASTEXITCODE -ne 0) { throw "gradle 构建失败（退出码 $LASTEXITCODE）" }
  } finally {
    Pop-Location
  }
} finally {
  if ($stashed) {
    Remove-Item $distDir -Recurse -Force -ErrorAction SilentlyContinue
    Move-Item $stashDir $distDir
  }
}

$apk = Join-Path $androidDir 'app\build\outputs\apk\debug\app-debug.apk'
if (-not (Test-Path $apk)) { throw "没找到构建产物：$apk" }

$dest = Join-Path $OutDir '金御汇-debug.apk'
Copy-Item $apk $dest -Force

$sizeMb = '{0:N2}' -f ((Get-Item $dest).Length / 1MB)
Write-Host ''
Write-Host "APK 已生成：$dest（$sizeMb MB）" -ForegroundColor Green
Write-Host "它连的是 $devUrl，电脑上要同时跑着 pnpm dev:server 和 pnpm dev:app。"
Write-Host '提醒：安卓工程现在指向你的电脑，出正式包前务必重跑 app:release。' -ForegroundColor Yellow
