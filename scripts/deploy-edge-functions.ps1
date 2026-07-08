param(
  [string]$ProjectRef = 'riaubhtruisbwdlwjzur'
)

$ErrorActionPreference = 'Stop'
$tok = [Environment]::GetEnvironmentVariable('SUPABASE_ACCESS_TOKEN', 'User')
if (-not $tok) { $tok = $env:SUPABASE_ACCESS_TOKEN }
if (-not $tok) {
  Write-Error 'SUPABASE_ACCESS_TOKEN not set (User env or $env:SUPABASE_ACCESS_TOKEN).'
}

$utf8NoBom = New-Object System.Text.UTF8Encoding $false
$tmpdir = Join-Path $env:TEMP 'supabase-deploy'
New-Item -ItemType Directory -Force -Path $tmpdir | Out-Null

function Deploy-Function {
  param(
    [string]$Slug,
    [string]$FilePath,
    [string]$Name
  )

  $metaPath = Join-Path $tmpdir "$Name-meta.json"
  $metaJson = '{"name":"' + $Name + '","entrypoint_path":"index.ts","verify_jwt":false}'
  [System.IO.File]::WriteAllText($metaPath, $metaJson, $utf8NoBom)

  $url = "https://api.supabase.com/v1/projects/$ProjectRef/functions/deploy?slug=$Slug"
  Write-Host "Deploying $Slug ..."
  $output = curl.exe -s -w "`nHTTP_STATUS:%{http_code}" -X POST $url `
    -H "Authorization: Bearer $tok" `
    -F "metadata=@$metaPath;type=application/json" `
    -F "file=@$FilePath"
  $text = ($output | Out-String)
  Write-Host $text.Trim()
  if (-not ($text -match 'HTTP_STATUS:200' -or $text -match 'HTTP_STATUS:201')) {
    throw "Deploy failed for $Slug"
  }
  Write-Host "OK: $Slug deployed"
}

$root = Split-Path -Parent $PSScriptRoot

Deploy-Function `
  -Slug 'supabase-functions-merge-shopify-product-variants' `
  -FilePath (Join-Path $root 'supabase\functions\merge-shopify-product-variants\index.ts') `
  -Name 'merge-shopify-product-variants'

Deploy-Function `
  -Slug 'supabase-functions-publish-to-shopify' `
  -FilePath (Join-Path $root 'supabase\functions\publish-to-shopify\index.ts') `
  -Name 'publish-to-shopify'

Deploy-Function `
  -Slug 'supabase-functions-update-shopify-product' `
  -FilePath (Join-Path $root 'supabase\functions\update-shopify-product\index.ts') `
  -Name 'update-shopify-product'

Deploy-Function `
  -Slug 'supabase-functions-sync-shopify-mirror' `
  -FilePath (Join-Path $root 'supabase\functions\sync-shopify-mirror\index.ts') `
  -Name 'sync-shopify-mirror'

Deploy-Function `
  -Slug 'supabase-functions-pms-sso' `
  -FilePath (Join-Path $root 'supabase\functions\pms-sso\index.ts') `
  -Name 'pms-sso'

Deploy-Function `
  -Slug 'supabase-functions-fetch-pms-staff-name' `
  -FilePath (Join-Path $root 'supabase\functions\fetch-pms-staff-name\index.ts') `
  -Name 'fetch-pms-staff-name'

Write-Host 'All functions deployed successfully.'
