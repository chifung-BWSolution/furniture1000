const SSO_LOGIN_SKIP_KEY = 'fds_sso_login_pending';

export function markSsoLoginPending(): void {
  try {
    sessionStorage.setItem(SSO_LOGIN_SKIP_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function consumeSsoLoginPending(): boolean {
  try {
    const v = sessionStorage.getItem(SSO_LOGIN_SKIP_KEY);
    if (v) sessionStorage.removeItem(SSO_LOGIN_SKIP_KEY);
    return Boolean(v);
  } catch {
    return false;
  }
}
