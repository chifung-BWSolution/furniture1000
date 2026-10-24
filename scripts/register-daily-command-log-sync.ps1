<#
.SYNOPSIS
  註冊／移除「FDS 指令記錄同步」Windows 排程（登入／開機時照 git commit 補跑）。

.DESCRIPTION
  排程在使用者登入時執行 scripts\daily-command-log-sync.mjs --git，
  照 repo 的 git commit 日期補跑 opencode／ChatGPT(Codex)／Cursor／WorkBuddy
  的指令記錄到 FDS 每日指令記錄。放假冇開機嘅日子，只要之後有開機就會
  自動補入（去重靠 externalId，重跑安全）。預設回看 30 日。

.EXAMPLE
  .\scripts\register-daily-command-log-sync.ps1
  .\scripts\register-daily-command-log-sync.ps1 -GitDays 90
  .\scripts\register-daily-command-log-sync.ps1 -Daily -Time 09:30   # 改返每日定時
  .\scripts\register-daily-command-log-sync.ps1 -Unregister
#>
[CmdletBinding()]
param(
  [string]$TaskName = "FDS Daily Command Log Sync",
  [switch]$Daily,
  [string]$Time = "09:30",
  [int]$GitDays = 30,
  [switch]$Unregister
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $repoRoot "scripts\daily-command-log-sync.mjs"

if ($Unregister) {
  $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $existing) {
    Write-Output "排程不存在：$TaskName"
    exit 0
  }
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Output "已移除排程：$TaskName"
  exit 0
}

if (-not (Test-Path -LiteralPath $scriptPath)) {
  throw "找不到同步腳本：$scriptPath"
}

$node = (Get-Command node -ErrorAction Stop).Source
$gitArgs = "--git --git-days $GitDays"

if ($Daily) {
  $at = [DateTime]::ParseExact($Time, "HH:mm", [Globalization.CultureInfo]::InvariantCulture)
  $argument = "`"$scriptPath`" --git --git-days $GitDays"
  $trigger = New-ScheduledTaskTrigger -Daily -At $at
  $mode = "每日 $Time"
} else {
  # 登入時跑：補跑回看期內所有有 commit 的日子（放假冇開機都會喺下次登入補返）
  $argument = "`"$scriptPath`" --git --git-days $GitDays"
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $mode = "登入時（$env:USERNAME）"
}

$action = New-ScheduledTaskAction -Execute $node -Argument $argument -WorkingDirectory $repoRoot
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2)

$description = "FDS 指令記錄同步：$mode 照 git commit 日期補跑 opencode／ChatGPT(Codex)／Cursor／WorkBuddy 指令記錄（--git --git-days $GitDays）"

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description $description `
  -Force | Out-Null

Write-Output "已註冊排程：$TaskName（$mode，node=$node）"
Write-Output "參數：$gitArgs"
Write-Output "工作目錄：$repoRoot"
Write-Output "手動觸發：Start-ScheduledTask -TaskName '$TaskName'"
