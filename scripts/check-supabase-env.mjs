/**
 * 檢查目前環境的 Supabase 變數有沒有指向正確的 project。
 *
 * 用途：Cursor Cloud Agent secrets / Vercel / 本機 .env.local 改動後，
 * 確認每個 key 真的屬於它應該屬於的專案（貼錯 key 是最常見的錯誤）。
 *
 * Usage:
 *   node scripts/check-supabase-env.mjs
 *   node scripts/check-supabase-env.mjs --live   # 額外對 REST API 發一次請求
 *
 * exit code 0 = 全部通過，1 = 有必需變數缺失或指向錯誤 project。
 */

const PROJECTS = {
  riaubhtruisbwdlwjzur: 'Furniture 1000',
  kqwktnplkqucsbasyfjl: 'PMS v3',
  kwcevjcmdjadhrygjyfp: 'MPS',
  gkqctvtteafjprkudgsb: 'beauty100',
};

const FURNITURE = 'riaubhtruisbwdlwjzur';
const PMS = 'kqwktnplkqucsbasyfjl';

/** name, required, expected ref, expected role (null = URL), 說明 */
const CHECKS = [
  ['VITE_SUPABASE_URL', true, FURNITURE, null, '前端主要連線'],
  ['VITE_SUPABASE_ANON_KEY', true, FURNITURE, 'anon', '前端主要連線'],
  ['VITE_MASTER_SUPABASE_ANON_KEY', false, PMS, 'anon', 'supabaseMaster.ts'],
  ['SUPABASE_SERVICE_ROLE_KEY', false, FURNITURE, 'service_role', 'scripts/*.mjs'],
  ['MASTER_SERVICE_ROLE_KEY', false, PMS, 'service_role', '跨專案讀 PMS'],
  ['MASTER_SUPABASE_URL', false, PMS, null, '跨專案讀 PMS'],
];

function decodeJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function refOf(value) {
  const url = /([a-z]{20})\.supabase\.co/.exec(value);
  if (url) return { ref: url[1], role: null };
  const claims = decodeJwt(value);
  if (claims?.ref) return { ref: claims.ref, role: claims.role ?? null };
  return null;
}

const label = (ref) => `${PROJECTS[ref] ?? 'UNKNOWN'} (${ref})`;

let failed = 0;
let warned = 0;

console.log('Supabase env check\n');

for (const [name, required, wantRef, wantRole, note] of CHECKS) {
  const value = process.env[name];
  if (!value) {
    if (required) {
      console.log(`  FAIL  ${name} — 未設定（${note} 會壞掉）`);
      failed++;
    } else {
      console.log(`  skip  ${name} — 未設定（選用：${note}）`);
    }
    continue;
  }
  const got = refOf(value);
  if (!got) {
    console.log(`  WARN  ${name} — 無法辨識格式（不是 URL 也不是 JWT）`);
    warned++;
    continue;
  }
  const refOk = got.ref === wantRef;
  const roleOk = wantRole === null || got.role === wantRole;
  if (refOk && roleOk) {
    console.log(`  ok    ${name} -> ${label(got.ref)}${got.role ? ` [${got.role}]` : ''}`);
  } else {
    console.log(
      `  FAIL  ${name} -> ${label(got.ref)}${got.role ? ` [${got.role}]` : ''}` +
        ` — 應該是 ${label(wantRef)}${wantRole ? ` [${wantRole}]` : ''}`
    );
    failed++;
  }
}

// 這個名字在其他 repo 指向別的 project，出現在本 repo 通常代表 secret 還是全域 scope
if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
  const got = refOf(process.env.NEXT_PUBLIC_SUPABASE_URL);
  console.log(
    `\n  WARN  NEXT_PUBLIC_SUPABASE_URL 存在（-> ${got ? label(got.ref) : '?'}）。` +
      '\n        本 repo 是 Vite，不會用到這個名字；它還在代表該 secret 仍是 All Repositories scope。'
  );
  warned++;
}

if (process.argv.includes('--live')) {
  console.log('\n連線測試：');
  for (const [name, , wantRef] of CHECKS) {
    const value = process.env[name];
    if (!value || !value.startsWith('ey')) continue;
    // /auth/v1/settings 對 anon 與 service_role 都回 200，key 無效才 401，
    // 不像 /rest/v1/ 根路徑會直接拒絕 anon（會產生假失敗）。
    const url = `https://${wantRef}.supabase.co/auth/v1/settings`;
    try {
      const res = await fetch(url, { headers: { apikey: value, Authorization: `Bearer ${value}` } });
      console.log(`  ${res.ok ? 'ok  ' : 'FAIL'}  ${name} -> ${label(wantRef)} HTTP ${res.status}`);
      if (!res.ok) failed++;
    } catch (err) {
      console.log(`  FAIL  ${name} -> ${label(wantRef)} ${err.message}`);
      failed++;
    }
  }
}

console.log(`\n${failed} failed, ${warned} warning(s)`);
process.exit(failed > 0 ? 1 : 0);
