import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { acquireLock, lockPathFor } from '../src/shared/instanceLock.js';

function tempLock(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-lock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'capital.lock');
}

test('lock: sits next to the database', () => {
  assert.equal(lockPathFor('./data/capital.db'), path.join(path.resolve('./data'), 'capital.lock'));
});

test('lock: a second copy is refused while the first is alive, and the lock is released on request', t => {
  const file = tempLock(t);
  const a = acquireLock(file, { pid: process.pid, now: 1 });
  assert.equal(a.ok, true);

  const b = acquireLock(file, { pid: process.pid + 1 });
  assert.deepEqual(b, { ok: false, path: file, pid: process.pid, startedAt: 1 });

  a.release();
  assert.equal(fs.existsSync(file), false);
  assert.equal(acquireLock(file).ok, true);
});

test('lock: a lock left by a dead process is taken over', t => {
  const file = tempLock(t);
  const dead = spawnSync(process.execPath, ['-e', '']).pid;
  fs.writeFileSync(file, JSON.stringify({ pid: dead, startedAt: 1 }));
  const r = acquireLock(file);
  assert.equal(r.ok, true);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).pid, process.pid);
});

test('lock: an unreadable lock file is treated as stale', t => {
  const file = tempLock(t);
  fs.writeFileSync(file, 'not json');
  assert.equal(acquireLock(file).ok, true);
});
