// Codex and its MCP child must never see the Worker's device credentials or any cloud key.
// Only an allowlist of OS variables is passed through; everything else is dropped.
const PASS = new Set([
  'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'PATHEXT', 'PATH', 'TEMP', 'TMP',
  'USERPROFILE', 'USERNAME', 'USERDOMAIN', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
  'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432', 'COMMONPROGRAMFILES',
  'COMMONPROGRAMFILES(X86)', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS', 'LANG',
  'CODEX_HOME', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY',
]);
const SECRET = /TOKEN|SECRET|KEY|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION|SUPABASE|SERVICE_ROLE|FDS_/i;

export function codexEnv(source = process.env, extra = {}) {
  const env = {};
  for (const [name, value] of Object.entries(source)) {
    const upper = name.toUpperCase();
    if (!PASS.has(upper) || value == null) continue;
    if (SECRET.test(upper) && upper !== 'CODEX_HOME') continue;
    env[name] = value;
  }
  return { ...env, ...extra };
}

/** Variables the MCP bridge needs; it reads nothing else from the environment. */
export function bridgeEnv({ port, jobId, nonce, screenDir, toolLog }) {
  return {
    FDS_CODEX_PORT: String(port),
    FDS_CODEX_JOB_ID: jobId,
    FDS_CODEX_NONCE: nonce,
    FDS_CODEX_SCREEN_DIR: screenDir,
    FDS_CODEX_TOOL_LOG: toolLog,
  };
}

/** Throws if a value that looks like one of our credentials leaked into an env map. */
export function assertNoSecrets(env, secrets) {
  const values = Object.values(env).join('\n');
  for (const secret of secrets) {
    if (secret && secret.length >= 12 && values.includes(secret)) throw new Error('codex_env_leak');
  }
}
