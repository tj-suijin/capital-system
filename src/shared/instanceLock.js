// Single-instance lock: two processes trading the same database would both
// open positions against the same ledgers. The lock is a file next to the
// database holding the owner's pid. A lock whose pid is no longer running
// (left behind by a crash or reboot) is taken over.
import fs from 'node:fs';
import path from 'node:path';

export const LOCK_HELD_EXIT_CODE = 3;

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // exists, but owned by another user
  }
}

export function lockPathFor(dbPath) {
  return path.join(path.dirname(path.resolve(dbPath)), 'capital.lock');
}

// Returns { ok: true, release } or { ok: false, pid, startedAt, path }.
export function acquireLock(lockPath, { pid = process.pid, now = Date.now() } = {}) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(lockPath, JSON.stringify({ pid, startedAt: now }), { flag: 'wx' });
      return { ok: true, path: lockPath, release: () => releaseLock(lockPath, pid) };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    let owner = null;
    try { owner = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch { /* unreadable: treat as stale */ }
    if (owner?.pid && owner.pid !== pid && alive(owner.pid)) {
      return { ok: false, path: lockPath, pid: owner.pid, startedAt: owner.startedAt ?? null };
    }
    fs.rmSync(lockPath, { force: true });
  }
  throw new Error(`Could not acquire lock ${lockPath}`);
}

export function releaseLock(lockPath, pid = process.pid) {
  try {
    const owner = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (owner.pid === pid) fs.rmSync(lockPath, { force: true });
  } catch { /* already gone */ }
}
