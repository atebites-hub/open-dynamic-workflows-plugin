// Exercise the real cleanup helper with a protected, unrelated /proc entry.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { test } from 'node:test';
import { transform } from 'esbuild';

const source = fs.readFileSync(new URL('../src/mcp/background.ts', import.meta.url), 'utf8');
const { code } = await transform(source + '\nexport { cleanupMarkedProcesses };', { loader: 'ts', format: 'esm' });
const { cleanupMarkedProcesses } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

async function probe({ protectedCode, signalCode, scanCode } = {}) {
  const originals = { readdirSync: fs.readdirSync, statSync: fs.statSync, readFileSync: fs.readFileSync };
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const kill = process.kill;
  const owned = process.pid + 1000, unrelated = owned + 1;
  const signalled = [];
  let alive = true;
  const failure = code => Object.assign(new Error(code), { code });
  Object.defineProperty(process, 'platform', { value: 'linux' });
  fs.readdirSync = () => {
    if (scanCode) throw failure(scanCode);
    return [String(unrelated), String(owned)];
  };
  fs.statSync = () => ({ uid: process.getuid() });
  fs.readFileSync = path => {
    const pid = Number(String(path).split('/')[2]);
    if (String(path).endsWith('/stat')) {
      const fields = Array(20).fill('0');
      fields[0] = pid === owned && !alive ? 'Z' : 'S';
      fields[19] = '12345';
      return `${pid} (fixture) ${fields.join(' ')}`;
    }
    if (pid === unrelated) throw failure(protectedCode ?? 'EACCES');
    return 'ODW_JOB_PROCESS_TOKEN=fixture-owner\0';
  };
  process.kill = (pid, signal) => {
    signalled.push(pid);
    assert.equal(pid, owned, 'must never signal an unclassified process');
    assert.equal(signal, 'SIGKILL');
    if (signalCode) throw failure(signalCode);
    alive = false;
    return true;
  };
  syncBuiltinESMExports();
  try { return { result: await cleanupMarkedProcesses('fixture-owner'), signalled, owned }; }
  finally {
    Object.assign(fs, originals);
    Object.defineProperty(process, 'platform', platform);
    process.kill = kill;
    syncBuiltinESMExports();
  }
}

test('protected unrelated processes do not break owned-process cleanup', async () => {
  for (const protectedCode of ['EACCES', 'EPERM']) {
    const { result, signalled, owned } = await probe({ protectedCode });
    assert.equal(result.complete, true, JSON.stringify(result));
    assert.deepEqual(signalled, [owned]);
  }
});

test('an owned-process kill denial still fails cleanup closed', async () => {
  const { result, signalled, owned } = await probe({ signalCode: 'EPERM' });
  assert.equal(result.complete, false);
  assert.match(result.error, /EPERM/);
  assert.deepEqual(signalled, [owned]);
});

test('an unreadable process directory still fails cleanup closed', async () => {
  const { result, signalled } = await probe({ scanCode: 'EACCES' });
  assert.equal(result.complete, false);
  assert.match(result.error, /EACCES/);
  assert.deepEqual(signalled, []);
});
