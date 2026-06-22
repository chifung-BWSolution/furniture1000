$out = "._probe_result.txt"
$tok = [Environment]::GetEnvironmentVariable("SUPABASE_ACCESS_TOKEN","User")
$ref = "riaubhtruisbwdlwjzur"
$sql = "SELECT (SELECT count(*) FROM pg_stat_activity) AS total_conns, (SELECT count(*) FROM pg_stat_activity WHERE state='active') AS active, (SELECT count(*) FROM pg_stat_activity WHERE state='idle in transaction') AS idle_in_txn, (SELECT setting FROM pg_settings WHERE name='max_connections') AS max_conns, (SELECT count(*) FROM products) AS product_count;"
$body = @{ query = $sql } | ConvertTo-Json
try {
  $r = Invoke-RestMethod -Method Post -Uri "https://api.supabase.com/v1/projects/$ref/database/query" -Headers @{ Authorization = "Bearer $tok"; "Content-Type"="application/json" } -Body $body -TimeoutSec 30
  ($r | ConvertTo-Json -Depth 5) | Out-File $out -Encoding utf8
} catch { "ERR: $($_.Exception.Message)" | Out-File $out -Encoding utf8 }
