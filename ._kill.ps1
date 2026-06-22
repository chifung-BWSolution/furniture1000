$out = "._kill_result.txt"
$tok = [Environment]::GetEnvironmentVariable("SUPABASE_ACCESS_TOKEN","User")
if (-not $tok) { "NO_TOKEN" | Out-File $out; exit }
$ref = "riaubhtruisbwdlwjzur"
$sql = "SELECT count(*) AS active_queries, max(EXTRACT(EPOCH FROM (now()-query_start))::int) AS longest_secs FROM pg_stat_activity WHERE state <> 'idle' AND pid <> pg_backend_pid();"
$body = @{ query = $sql } | ConvertTo-Json
try {
  $r = Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/$ref/database/query" -Headers @{ Authorization = "Bearer $tok"; "Content-Type"="application/json" } -Body $body -TimeoutSec 30
  ($r | ConvertTo-Json -Depth 5) | Out-File $out -Encoding utf8
} catch { "ERR: $($_.Exception.Message)" | Out-File $out -Encoding utf8 }
