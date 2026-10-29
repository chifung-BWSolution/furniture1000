// One SketchUp automation at a time on this machine, across Worker processes and job types.
// The lock file records who holds it; a holder whose process is gone is treated as stale.
import { execFile } from 'node:child_process';
import { open, readFile, rm, stat, writeFile } from 'node:fs/promises';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

export function processImage(pid) {
  return new Promise((resolve) => {
    execFile('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true }, (error, stdout) => {
      if (error) return resolve(null);
      const match = String(stdout).match(/^"([^"]+)"/m);
      resolve(match ? match[1] : null);
    });
  });
}

export function killTree(pid) {
  return new Promise((resolve) => {
    if (!pidAlive(pid)) return resolve();
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
  });
}

async function readHolder(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Resolves with { release, update } once this process owns the lock.
 * `onWait(holder)` is called every poll while someone else owns it; throw from it to give up.
 * A crashed Worker can leave its dedicated SketchUp running; that process is ours and gets closed.
 */
export async function acquireSketchUpLock(path, owner, { onWait, pollMs = 5_000, staleMs = 6 * 60 * 60 * 1000 } = {}) {
  for (;;) {
    try {
      const handle = await open(path, 'wx');
      let holder = { ...owner, pid: process.pid, acquired_at: new Date().toISOString() };
      await handle.writeFile(JSON.stringify(holder));
      await handle.close();
      return {
        async update(fields) {
          holder = { ...holder, ...fields };
          const current = await readHolder(path);
          if (current?.pid === process.pid && current?.token === holder.token) await writeFile(path, JSON.stringify(holder));
        },
        async release() {
          const current = await readHolder(path);
          if (current?.pid === process.pid && current?.token === holder.token) await rm(path, { force: true });
        },
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
    const holder = await readHolder(path);
    const age = await stat(path).then((s) => Date.now() - s.mtimeMs).catch(() => 0);
    const workerAlive = holder ? pidAlive(holder.pid) : age < 60_000;
    if (!workerAlive || age > staleMs) {
      if (holder?.sketchup_pid && pidAlive(holder.sketchup_pid)) {
        const image = await processImage(holder.sketchup_pid);
        if (/^sketchup\.exe$/i.test(image ?? '')) await killTree(holder.sketchup_pid);
      }
      await rm(path, { force: true });
      continue;
    }
    await onWait?.(holder);
    await sleep(pollMs);
  }
}
