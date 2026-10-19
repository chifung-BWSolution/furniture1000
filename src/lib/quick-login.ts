export type QuickLoginCredentials = {
  email: string;
  password: string;
};

/** True only for builds whose Git branch is exactly `develop`. */
export function isDevelopQuickLoginBuild(): boolean {
  return import.meta.env.VITE_LOGIN_METHOD === 'quick';
}

/** Credentials are injected by Vite only when the Git branch is exactly `develop`. */
export function getQuickLoginCredentials(): QuickLoginCredentials | null {
  if (import.meta.env.VITE_ENABLE_QUICK_LOGIN !== 'true') return null;

  const email = String(import.meta.env.VITE_QUICK_LOGIN_EMAIL || '').trim();
  const password = String(import.meta.env.VITE_QUICK_LOGIN_PASSWORD || '');
  if (!email || !password) return null;

  return { email, password };
}
