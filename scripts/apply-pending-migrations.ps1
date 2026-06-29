# Apply pending SQL migrations from supabase/migrations via Supabase Management API.
# Token: Windows User env SUPABASE_ACCESS_TOKEN only (never written to disk).
param(
  [string]$ProjectRef = 'riaubhtruisbwdlwjzur',
  [string]$MigrationsDir = (Join-Path $PSScriptRoot '..\supabase\migrations')
)

$ErrorActionPreference = 'Stop'
$token = [Environment]::GetEnvironmentVariable('SUPABASE_ACCESS_TOKEN', 'User')
if (-not $token) { $token = $env:SUPABASE_ACCESS_TOKEN }
if (-not $token) { throw 'SUPABASE_ACCESS_TOKEN not set in User environment variables' }

$base = "https://api.supabase.com/v1/projects/$ProjectRef"
$headers = @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' }

function Invoke-DbQuery([string]$Query) {
  $body = @{ query = $Query } | ConvertTo-Json -Compress
  return Invoke-RestMethod -Method Post -Uri "$base/database/query" -Headers $headers -Body $body
}

Write-Host "Fetching applied migrations..."
$appliedRows = Invoke-DbQuery "select version, name from supabase_migrations.schema_migrations order by version"
$appliedNames = @{}
foreach ($row in $appliedRows) {
  if ($row.name) { $appliedNames[$row.name] = $true }
}

$localFiles = Get-ChildItem -Path $MigrationsDir -Filter '*.sql' | Sort-Object Name
$pending = @()
foreach ($f in $localFiles) {
  if ($f.Name -match '^(\d+)_(.+)\.sql$') {
    $slug = $Matches[2]
    if (-not $appliedNames.ContainsKey($slug)) {
      $pending += [pscustomobject]@{ File = $f.FullName; Name = $slug }
    }
  }
}

Write-Host "Local files: $($localFiles.Count) | Applied (named): $($appliedNames.Count) | Pending by name: $($pending.Count)"
if ($pending.Count -eq 0) {
  Write-Host 'No pending migrations (by migration name).'
  exit 0
}

# Safety: only auto-apply recent performance/migration RPC files unless -All is passed
$autoAllow = @(
  'lightweight_publish_rts_rows',
  'reconcile_category_registry_rpc',
  'fix_postgrest_500s',
  'expand_image_migration_rpcs'
)
$toApply = $pending | Where-Object { $autoAllow -contains $_.Name }
if ($toApply.Count -eq 0) {
  Write-Host 'Pending migrations exist but none match auto-apply allowlist. First 10 pending names:'
  $pending | Select-Object -First 10 | ForEach-Object { Write-Host "  - $($_.Name)" }
  exit 0
}

foreach ($m in $toApply) {
  Write-Host "Applying: $($m.Name) ..."
  $sql = Get-Content -Path $m.File -Raw -Encoding UTF8
  if ($m.Name -eq 'expand_image_migration_rpcs' -and $sql -notmatch 'drop function if exists public.get_rts_image_migration_batch') {
    $sql = "drop function if exists public.get_rts_image_migration_batch(integer);`n" + $sql
  }
  $payload = @{ name = $m.Name; query = $sql } | ConvertTo-Json -Depth 3
  try {
    Invoke-RestMethod -Method Post -Uri "$base/database/migrations" -Headers $headers -Body $payload | Out-Null
    Write-Host "  OK: $($m.Name)"
  } catch {
    Write-Warning "  FAILED $($m.Name): $($_.Exception.Message)"
  }
}

Write-Host 'Verifying key RPCs...'
$check = Invoke-DbQuery @"
select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and proname in (
  'get_products_list_page','get_publish_rts_rows','reconcile_category_registry',
  'get_products_image_migration_count','rts_row_needs_image_migration'
) order by proname;
"@
$check | ForEach-Object { Write-Host "  fn: $($_.proname)" }

Invoke-DbQuery "notify pgrst, 'reload schema';" | Out-Null
Write-Host 'Done. PostgREST schema reload notified.'
