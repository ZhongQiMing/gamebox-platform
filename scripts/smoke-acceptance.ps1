# Local smoke acceptance for gamebox API
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-acceptance.ps1
$ErrorActionPreference = 'Stop'
$Base = if ($env:SMOKE_BASE_URL) { $env:SMOKE_BASE_URL } else { 'http://localhost:3000/api' }

function Invoke-Api {
  param(
    [string]$Method,
    [string]$Path,
    [object]$Body = $null,
    [string]$Token = ''
  )
  $headers = @{ 'Content-Type' = 'application/json' }
  if ($Token) { $headers['Authorization'] = "Bearer $Token" }
  $uri = "$Base$Path"
  if ($null -ne $Body) {
    $json = $Body | ConvertTo-Json -Depth 8 -Compress
    return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -Body $json
  }
  return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers
}

function Assert-True {
  param([bool]$Cond, [string]$Msg)
  if (-not $Cond) { throw "ASSERT FAIL: $Msg" }
  Write-Host "  PASS  $Msg"
}

$results = New-Object System.Collections.Generic.List[object]
function Record {
  param([string]$Name, [scriptblock]$Block)
  Write-Host ""
  Write-Host "==> $Name"
  try {
    & $Block
    $results.Add([pscustomobject]@{ name = $Name; ok = $true; error = '' }) | Out-Null
  } catch {
    $results.Add([pscustomobject]@{ name = $Name; ok = $false; error = $_.Exception.Message }) | Out-Null
    Write-Host "  FAIL  $($_.Exception.Message)" -ForegroundColor Red
  }
}

# username: letters+digits, 8-20 chars
$suffix = ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() % 100000000).ToString()
$playerUser = ("smokep{0}" -f $suffix)  # e.g. smokep43660773 (14 chars)
$playerPass = 'Test123456'
$adminToken = ''
$playerToken = ''
$playerId = ''
$balAfterCredit = 0
$orderId = ''

Record 'health' {
  $r = Invoke-Api GET '/health'
  Assert-True ($r.code -eq 0) 'envelope code=0'
  Assert-True ($r.data.status -eq 'ok') 'status=ok'
  Assert-True ($r.data.db -eq 'up') 'db up'
  Assert-True ($r.data.redis -eq 'up') 'redis up'
}

Record 'admin_login' {
  $r = Invoke-Api POST '/auth/login' @{ username = 'admin'; password = 'Admin@123456' }
  Assert-True ($r.code -eq 0) 'login ok'
  Assert-True (-not [string]::IsNullOrEmpty($r.data.token)) 'has token'
  $script:adminToken = [string]$r.data.token
}

Record 'player_register' {
  $r = Invoke-Api POST '/auth/register' @{
    username = $playerUser
    password = $playerPass
    nickname = 'SmokePlayer'
  }
  Assert-True ($r.code -eq 0) 'register ok'
  Assert-True (-not [string]::IsNullOrEmpty($r.data.token)) 'has token'
  $script:playerToken = [string]$r.data.token
  $script:playerId = [string]$r.data.user.id
  Assert-True (-not [string]::IsNullOrEmpty($script:playerId)) 'has user id'
}

Record 'games_catalog' {
  $r = Invoke-Api GET '/games'
  Assert-True ($r.code -eq 0) 'games list'
  $codes = @($r.data | ForEach-Object { $_.code })
  Assert-True ($codes -contains 'fruit-machine') 'has fruit-machine'
  Assert-True ($codes -contains 'dragon-tiger') 'has dragon-tiger'
}

Record 'recharge_credit_flow' {
  # PLAYER cannot receive agent issue; use recharge apply + admin approve
  $apply = Invoke-Api POST '/recharge/apply' @{
    amount = 10000
    channel = 'SMOKE'
  } -Token $playerToken
  Assert-True ($apply.code -eq 0) 'recharge apply ok'
  $script:orderId = [string]$apply.data.id
  Assert-True (-not [string]::IsNullOrEmpty($script:orderId)) 'has order id'

  $approve = Invoke-Api PATCH "/recharge/$($script:orderId)/approve" $null -Token $adminToken
  Assert-True ($approve.code -eq 0) 'admin approve ok'

  $bal = Invoke-Api GET '/wallet/balance' -Token $playerToken
  Assert-True ([int]$bal.data.balance -ge 10000) ("balance>=10000 got {0}" -f $bal.data.balance)
  $script:balAfterCredit = [int]$bal.data.balance
}

Record 'fruit_spin' {
  $fruitReq = "fruit_smoke_$(Get-Random)_$([guid]::NewGuid().ToString('N').Substring(0,8))"
  $r = Invoke-Api POST '/bet/fruit' @{
    gameCode = 'fruit-machine'
    bets = @{ apple = 10; orange = 10 }
    clientRequestId = $fruitReq
  } -Token $playerToken
  Assert-True ($r.code -eq 0) 'fruit spin ok'
  Assert-True ($null -ne $r.data.awardType) 'has awardType'
  Assert-True ($null -ne $r.data.balance) 'has balance'
  $fruitBal = [int]$r.data.balance
  $r2 = Invoke-Api POST '/bet/fruit' @{
    gameCode = 'fruit-machine'
    bets = @{ apple = 10; orange = 10 }
    clientRequestId = $fruitReq
  } -Token $playerToken
  Assert-True ($r2.code -eq 0) 'fruit idempotent replay ok'
  Assert-True ([int]$r2.data.balance -eq $fruitBal) 'fruit idempotent balance unchanged'
}

Record 'table_snapshot' {
  $r = Invoke-Api GET '/table/dragon-tiger/snapshot'
  Assert-True ($r.code -eq 0) 'snapshot ok'
  Assert-True ($r.data.gameCode -eq 'dragon-tiger') 'gameCode'
  Assert-True (@('BETTING', 'DRAWING', 'SETTLED', 'PAUSED') -contains $r.data.phase) ("phase={0}" -f $r.data.phase)
  Assert-True ([int]$r.data.secondsLeft -ge 0) 'secondsLeft>=0'
}

Record 'bet_history' {
  $r = Invoke-Api GET '/bet/history' -Token $playerToken
  Assert-True ($r.code -eq 0) 'history ok'
  Assert-True (@($r.data).Count -ge 1) 'has at least 1 record'
}

Record 'balance_ledger_reconcile' {
  $bal = Invoke-Api GET '/wallet/balance' -Token $playerToken
  $now = [int]$bal.data.balance
  Assert-True ($now -ge 0) ("balance non-negative got {0}" -f $now)

  $hist = Invoke-Api GET '/bet/history' -Token $playerToken
  $rows = @($hist.data)
  $betSum = 0
  $paySum = 0
  foreach ($row in $rows) {
    $betSum += [int]$row.amount
    $paySum += [int]$row.payout
  }
  $expected = $balAfterCredit - $betSum + $paySum
  Assert-True ($now -eq $expected) ("ledger reconcile now={0} expected={1} (credit={2} bet={3} pay={4})" -f $now, $expected, $balAfterCredit, $betSum, $paySum)
}

Record 'self_approve_forbidden' {
  # player should not approve own recharge (create another pending then try self-approve)
  $apply = Invoke-Api POST '/recharge/apply' @{
    amount = 50
    channel = 'SMOKE2'
  } -Token $playerToken
  Assert-True ($apply.code -eq 0) 'second apply ok'
  $oid = [string]$apply.data.id
  $blocked = $false
  try {
    Invoke-Api PATCH "/recharge/$oid/approve" $null -Token $playerToken | Out-Null
  } catch {
    $blocked = $true
  }
  Assert-True $blocked 'player cannot approve recharge'
}

Write-Host ""
Write-Host "========== ACCEPTANCE SUMMARY =========="
$pass = @($results | Where-Object { $_.ok }).Count
$fail = @($results | Where-Object { -not $_.ok }).Count
foreach ($row in $results) {
  $mark = if ($row.ok) { '[OK]' } else { '[NG]' }
  Write-Host ("{0} {1}" -f $mark, $row.name)
  if (-not $row.ok) { Write-Host ("     {0}" -f $row.error) -ForegroundColor Yellow }
}
Write-Host ("TOTAL: {0} passed / {1} failed / {2} cases" -f $pass, $fail, $results.Count)
if ($fail -gt 0) { exit 1 }
exit 0
