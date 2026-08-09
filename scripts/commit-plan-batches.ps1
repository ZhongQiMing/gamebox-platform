# 按「后台现状与下一步」分批提交（需已配置 git user.name / user.email）
# 用法：在仓库根目录执行  powershell -File scripts/commit-plan-batches.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

function Commit-IfStaged([string]$msg) {
  $n = (git diff --cached --name-only | Measure-Object).Count
  if ($n -eq 0) { Write-Host "skip (empty): $msg"; return }
  git commit -m $msg
  Write-Host "ok: $msg ($n files)"
}

# 1) 垃圾清理
git add -u -- _prototype bjNew remove_bg.py remove_white_bg.py
git add -- .gitignore
Commit-IfStaged @"
chore(repo): 移除 _prototype、bjNew 与根目录临时脚本

清理已废弃原型与备份目录，并更新 .gitignore 防止误加回仓库。
"@

# 2) 文档
git add -- docs/控制台角色验收清单.md docs/真分假分飞盘说明.md docs/01-落地方案.md docs/05-工程实施清单.md docs/上线验收清单.md
Commit-IfStaged @"
docs: 补充控制台验收与真分飞盘说明并更新清单

对齐三端后台已落地现状，便于四角色手测与上线前核对。
"@

# 3) 运维脚本 + seed
git add -- scripts/backup-on-server.sh scripts/restore-on-server.sh scripts/health-alert.mjs scripts/health-alert.env.example scripts/download-local-fonts.mjs
git add -- server/prisma/seed.ts server/.env.example
Commit-IfStaged @"
chore(ops): PG 备份脚本与生产 seed 禁弱口令

预留宝塔定时备份；生产创建管理员必须 SEED_ADMIN_PASSWORD。
"@

# 4) admin 边角（本次计划改动）
git add -- admin-panel/package.json admin-panel/vite.config.ts admin-panel/src/api/admin.ts admin-panel/src/views/RoomDetailView.vue
git add -- pnpm-lock.yaml
Commit-IfStaged @"
refactor(admin): 澄清额度文案并移除未用 echarts/agentApi

绑定代理四字文案对齐真分/飞盘含义；去掉未引用的图表依赖。
"@

Write-Host ''
Write-Host '本脚本只提交计划内批次。其余 server/admin/client 大量改动请另开提交：'
Write-Host '  git add server && git commit -m "feat(server): ..."'
Write-Host '  git add admin-panel && git commit -m "feat(admin): ..."'
Write-Host '  git add client-app && git commit -m "feat(client): ..."'
Write-Host '  git add games-assets && git commit -m "feat(games): ..."'
git status -sb | Select-Object -First 8
