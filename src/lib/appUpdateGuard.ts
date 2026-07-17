/**
 * Detects stale assets after a production redeploy and prompts the user
 * instead of calling window.location.reload() immediately.
 *
 * Quote editors register a draft flush hook via unsavedGuard so we can
 * persist IndexedDB drafts before any voluntary reload.
 */

import { unsavedGuard } from '@/lib/unsavedGuard';

export type AppUpdateReason =
  | 'vite-preload-error'
  | 'dynamic-import-failed'
  | 'error-boundary'
  | 'build-id-mismatch'
  | 'manual';

type Listener = (state: AppUpdateState) => void;

export type AppUpdateState = {
  visible: boolean;
  reason: AppUpdateReason | null;
  detectedAt: number | null;
  snoozedUntil: number | null;
};

const SNOOZE_MS = 15 * 60 * 1000;
const BUILD_POLL_MS = 5 * 60 * 1000;
const STALE_MSG_MARKERS = [
  'Failed to fetch dynamically imported module',
  'Importing a module script failed',
  'error loading dynamically imported module',
];

const listeners = new Set<Listener>();

let state: AppUpdateState = {
  visible: false,
  reason: null,
  detectedAt: null,
  snoozedUntil: null,
};

let bootBuildId: string | null = null;
let started = false;

function emit() {
  for (const listener of listeners) {
    try {
      listener(state);
    } catch {
      // ignore listener errors
    }
  }
}

function setState(patch: Partial<AppUpdateState>) {
  state = { ...state, ...patch };
  emit();
}

export function isStaleAssetErrorMessage(msg: string): boolean {
  return STALE_MSG_MARKERS.some((m) => msg.includes(m));
}

export function getAppUpdateState(): AppUpdateState {
  return state;
}

export function subscribeAppUpdate(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

/** Flush quote draft (if registered) then show the update banner. Never auto-reloads. */
export async function notifyAppUpdate(reason: AppUpdateReason): Promise<void> {
  const now = Date.now();
  if (state.snoozedUntil && now < state.snoozedUntil) {
    console.info('[appUpdateGuard] snoozed; skip banner', reason);
    return;
  }

  try {
    await unsavedGuard.flushDraft();
  } catch (err) {
    console.warn('[appUpdateGuard] flushDraft failed', err);
  }

  console.info('[appUpdateGuard] stale/update detected', reason, {
    dirty: unsavedGuard.isDirty,
  });

  setState({
    visible: true,
    reason,
    detectedAt: now,
  });
}

export function snoozeAppUpdate(ms: number = SNOOZE_MS): void {
  setState({
    visible: false,
    snoozedUntil: Date.now() + ms,
  });
}

export function dismissAppUpdateBanner(): void {
  setState({ visible: false });
}

/**
 * User-confirmed reload: flush draft again, then reload.
 * Callers should write resume markers before invoking if needed.
 */
export async function reloadAfterFlush(): Promise<void> {
  try {
    await unsavedGuard.flushDraft();
  } catch {
    // continue — user explicitly asked to reload
  }
  window.location.reload();
}

async function readRemoteBuildId(): Promise<string | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}version.json?_=${Date.now()}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { buildId?: string };
    return data.buildId?.trim() || null;
  } catch {
    return null;
  }
}

async function checkBuildId(): Promise<void> {
  const remote = await readRemoteBuildId();
  if (!remote) return;
  if (!bootBuildId) {
    bootBuildId = remote;
    return;
  }
  if (remote !== bootBuildId) {
    await notifyAppUpdate('build-id-mismatch');
  }
}

/** Wire global listeners once (call from main.tsx). */
export function startAppUpdateGuard(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  bootBuildId =
    (typeof import.meta !== 'undefined' &&
      (import.meta.env.VITE_APP_BUILD_ID as string | undefined)?.trim()) ||
    null;

  window.addEventListener('vite:preloadError', (e) => {
    e.preventDefault();
    void notifyAppUpdate('vite-preload-error');
  });

  window.addEventListener('unhandledrejection', (event) => {
    const msg = String(event?.reason?.message || event?.reason || '');
    if (!isStaleAssetErrorMessage(msg)) return;
    event.preventDefault();
    void notifyAppUpdate('dynamic-import-failed');
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void checkBuildId();
    }
  });

  window.setTimeout(() => {
    void checkBuildId();
  }, 3_000);
  window.setInterval(() => {
    void checkBuildId();
  }, BUILD_POLL_MS);
}
