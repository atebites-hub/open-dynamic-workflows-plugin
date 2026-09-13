// Real packaged MCP/processes/worktrees; fake model CLI, never live attestation.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const server = resolve(import.meta.dirname, '../dist/mcp/server.js');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const terminal = job => ['completed', 'failed', 'cancelled', 'timed_out', 'interrupted'].includes(job.state);

async function waitUntil(check, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, 'condition did not become true before deadline');
    await sleep(30);
  }
}

function client(root, fake) {
  const child = spawn(process.execPath, [server], {
    cwd: root,
    env: { ...process.env, ODW_HOST: 'grok-bot', ODW_REQUIRE_CWD: '', ODW_LEAF: '', ODW_CURSOR_LEAF: '', ODW_GROK_LEAF: '', CURSOR_BIN: fake },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let sequence = 0, pending = '';
  const replies = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    pending += chunk;
    let newline;
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
      if (line.trim()) { const message = JSON.parse(line); replies.get(message.id)?.(message); }
    }
  });
  child.stderr.resume();
  const request = (method, params) => new Promise((resolveRequest, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { replies.delete(id); reject(new Error('short MCP request exceeded 5 seconds')); }, 5000);
    replies.set(id, message => { clearTimeout(timer); replies.delete(id); resolveRequest(message); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  return {
    child, request,
    call: (name, args) => request('tools/call', { name, arguments: args }),
    notify: params => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params }) + '\n'),
    close: () => { child.stdin.end(); child.kill(); },
  };
}

test('Grok Bot jobs survive request cancellation/reconnect and retain bounded results', { timeout: 120000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'odw-background-'));
  const repo = join(root, 'repo'); mkdirSync(repo);
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-q');
  writeFileSync(join(repo, 'shared.txt'), 'base\n');
  writeFileSync(join(repo, '.gitignore'), '.odw/\n');
  git('add', '.'); git('-c', 'user.name=ODW fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture');
  const fake = join(root, 'fake-cursor');
  const launches = join(root, 'launches');
  writeFileSync(fake, `#!/usr/bin/env node
const fs=require('node:fs'),cp=require('node:child_process');
const cfg=JSON.parse(process.argv.at(-1));
fs.appendFileSync(${JSON.stringify(launches)},JSON.stringify({pid:process.pid,cwd:process.cwd()})+'\\n');
console.log(JSON.stringify({type:'system',subtype:'init',session_id:'fixture-'+process.pid,model:'fixture'}));
fs.writeFileSync('shared.txt',cfg.marker+'\\n');
if(cfg.pidFile){const nested=cp.spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(cfg.pidFile,JSON.stringify({pid:process.pid,nested:nested.pid}));}
setTimeout(()=>{console.log(JSON.stringify({type:'result',subtype:cfg.fail?'error_during_execution':'success',is_error:!!cfg.fail,result:cfg.marker,session_id:'fixture-'+process.pid}));process.exit(cfg.fail?1:0);},cfg.delay);
`);
  chmodSync(fake, 0o755);
  let mcp = client(repo, fake);
  const jobs = [];
  const unpack = reply => JSON.parse(reply.result.content[0].text);
  const status = async jobId => unpack(await mcp.call('workflow_status', { cwd: repo, jobId, waitSeconds: 1 }));
  const finish = async (jobId, timeout = 10000) => {
    let job;
    await waitUntil(async () => { job = await status(jobId); return terminal(job); }, timeout);
    return job;
  };
  const script = (name, configs) => `export const meta={name:${JSON.stringify(name)},description:'background fixture'}; return await parallel([${configs.map(cfg => `()=>agent(${JSON.stringify(JSON.stringify(cfg))},{retries:0})`).join(',')}]);`;
  const start = async args => {
    const reply = await mcp.call('workflow', { cwd: repo, isolation: 'worktree', ...args });
    assert.equal(reply.result.isError, false, JSON.stringify(reply));
    const job = unpack(reply); assert.equal(job.terminal, false); assert.equal(job.ok, null);
    assert.equal(typeof job.jobId, 'string'); jobs.push(job.jobId); return job;
  };
  try {
    const listed = await mcp.request('tools/list', {});
    assert.deepEqual(listed.result.tools.map(tool => tool.name), ['workflow', 'workflow_status', 'workflow_cancel']);
    const invalid = await mcp.call('workflow', { cwd: 'relative', script: 'bad' });
    assert.equal(invalid.result.isError, true);
    assert.equal(existsSync(launches), false);

    const delay = process.env.ODW_LONG_TEST === '1' ? 65000 : 900;
    const args = { requestId: 'disconnect-proof', maxSeconds: 90, script: script('disconnected', [{ marker: 'one', delay }, { marker: 'two', delay }]) };
    const job = await start(args);
    const repeated = unpack(await mcp.call('workflow', { cwd: repo, isolation: 'worktree', ...args }));
    assert.equal(repeated.jobId, job.jobId, 'idempotent start must not duplicate workers');
    const conflict = await mcp.call('workflow', { cwd: repo, ...args, script: script('different', []) });
    assert.equal(conflict.result.isError, true);
    mcp.notify({ requestId: 3, reason: 'expired completed start request' });
    mcp.close();
    mcp = client(repo, fake);
    const completed = await finish(job.jobId, delay + 15000);
    assert.equal(completed.state, 'completed', JSON.stringify(completed));
    assert.equal(completed.ok, true);
    assert.equal(completed.result.failedAgents, 0);
    assert.equal(completed.result.durable, true);
    assert.deepEqual(completed.result.executionContext, { host: 'grok-bot', defaultExecutor: 'cursor' });
    const records = readFileSync(launches, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(records.length, 2);
    assert.equal(new Set(records.map(record => record.cwd)).size, 2);
    assert.deepEqual(records.map(record => readFileSync(join(record.cwd, 'shared.txt'), 'utf8')).sort(), ['one\n', 'two\n']);
    assert.equal(readFileSync(join(repo, 'shared.txt'), 'utf8'), 'base\n');
    assert.ok(completed.result.worktreeNotes.some(note => note.includes('receipt=')));

    const failed = await start({ script: script('failed', [{ marker: 'bad', delay: 20, fail: true }]) });
    const failure = await finish(failed.jobId);
    assert.equal(failure.state, 'failed'); assert.equal(failure.ok, false);
    assert.equal(failure.result.failedAgents, 1, 'script completion must not hide failed nodes');

    const pidFile = join(root, 'pids');
    const cancelled = await start({ script: script('cancelled', [{ marker: 'partial', delay: 60000, pidFile }]) });
    await waitUntil(() => existsSync(pidFile));
    await mcp.call('workflow_cancel', { cwd: repo, jobId: cancelled.jobId });
    const cancellation = await finish(cancelled.jobId);
    assert.equal(cancellation.state, 'cancelled'); assert.equal(cancellation.ok, false);
    assert.equal(unpack(await mcp.call('workflow_cancel', { cwd: repo, jobId: cancelled.jobId })).state, 'cancelled');
    const tracePath = join(repo, '.odw', 'cancelled', 'runs', cancellation.runId, 'agents', 'agent-1.jsonl');
    const trace = JSON.parse(readFileSync(tracePath, 'utf8'));
    assert.equal(trace.isError, true); assert.equal(trace.exitCode, null);
    assert.ok(trace.events.some(event => event.session_id));
    const pids = JSON.parse(readFileSync(pidFile, 'utf8'));
    await waitUntil(() => Object.values(pids).every(pid => {
      try { return /Z/.test(execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })); }
      catch { return true; }
    }));

    const timed = await start({ maxSeconds: 1, script: "export const meta={name:'deadline',description:'CPU-bound script'}; while(true){}" });
    const timeout = await finish(timed.jobId, 12000);
    assert.equal(timeout.state, 'timed_out'); assert.equal(timeout.ok, false);
    assert.equal((await mcp.call('workflow_status', { cwd: repo, jobId: '../escape' })).result.isError, true);
    assert.equal((await mcp.call('workflow_status', { cwd: root, jobId: job.jobId })).result.isError, true);
    assert.equal((await mcp.call('workflow', { cwd: repo, maxSeconds: 0, script: script('bad-time', []) })).result.isError, true);
  } finally {
    for (const jobId of jobs) {
      try { await mcp.call('workflow_cancel', { cwd: repo, jobId }); await finish(jobId); } catch { /* preserve failure output */ }
    }
    mcp.close();
    rmSync(root, { recursive: true, force: true });
  }
});
