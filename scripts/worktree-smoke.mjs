// Real packaged MCP + real Git worktrees; fake model CLI, never live attestation.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const host = process.argv[2] ?? 'zcode';
assert.ok(['zcode', 'cursor', 'grok-bot'].includes(host), 'unsupported fixture host');
const kind = host === 'grok-bot' ? 'cursor' : host;
const root = mkdtempSync(join(tmpdir(), 'odw-packaged-isolation-'));
const repo = join(root, 'repo');
mkdirSync(repo);
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: 'pipe' }).trim();
git('init', '-q');
writeFileSync(join(repo, 'shared.txt'), 'base\n');
writeFileSync(join(repo, '.gitignore'), '.odw/\n');
git('add', '.');
git('-c', 'user.name=ODW fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture');
const fake = join(root, 'zcode-fixture');
writeFileSync(fake, `#!/usr/bin/env node
const fs=require('node:fs');const cp=require('node:child_process');
const branch=cp.execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim();
if(!branch.startsWith('odw/')||process.env.ODW_LEAF!=='1')process.exit(9);
const prompt=process.env.ODW_FIXTURE_KIND==='cursor'?process.argv.at(-1):process.argv[process.argv.indexOf('--prompt')+1];
fs.writeFileSync('shared.txt',prompt+'\\n');
const text=JSON.stringify({branch,cwd:process.cwd()});
console.log(JSON.stringify(process.env.ODW_FIXTURE_KIND==='cursor'?{type:'result',subtype:'success',is_error:false,result:text,session_id:'fake-'+process.pid}:{type:'zcode_result',text,stderr:'',exitCode:0,sessionId:'fake-'+process.pid,telemetryAvailable:false}));
`);
chmodSync(fake, 0o755);
const child = spawn(process.execPath, [resolve(import.meta.dirname, '../dist/mcp/server.js')], {
  cwd: repo, env: { ...process.env, ODW_HOST: host, ODW_REQUIRE_CWD: '', ODW_LEAF: '',
    ODW_GROK_LEAF: '', ODW_CURSOR_LEAF: '', ODW_FIXTURE_KIND: kind, ZCODE_BIN: fake, CURSOR_BIN: fake },
  stdio: ['pipe', 'pipe', 'pipe'],
});
let pending = '';
const replies = new Map();
child.stdout.setEncoding('utf8');
child.stdout.on('data', (data) => {
  pending += data;
  let end;
  while ((end = pending.indexOf('\n')) !== -1) {
    const line = pending.slice(0, end); pending = pending.slice(end + 1);
    if (line.trim()) { const message = JSON.parse(line); replies.get(message.id)?.(message); }
  }
});
child.stderr.resume();
const request = (id, method, params) => new Promise((resolveRequest, reject) => {
  const timeout = setTimeout(() => reject(new Error('packaged isolation probe timed out')), 20000);
  replies.set(id, (message) => { clearTimeout(timeout); resolveRequest(message); });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
try {
  await request(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'worktree-fixture', version: '1' } });
  const listed = await request(2, 'tools/list', {});
  assert.deepEqual(listed.result.tools[0].inputSchema.properties.isolation.enum, ['worktree']);
  const reply = await request(3, 'tools/call', { name: 'workflow', arguments: {
    cwd: repo, isolation: 'worktree',
    script: "export const meta={name:'two-writers',description:'packaged isolation'}; return await parallel([()=>agent('one',{retries:0}),()=>agent('two',{retries:0})]);",
  } });
  assert.equal(reply.result.isError, false);
  const result = JSON.parse(reply.result.content[0].text);
  assert.deepEqual(result.executionContext, { host, defaultExecutor: kind });
  assert.equal(result.failedAgents, 0);
  assert.equal(result.durable, true);
  const workers = result.value.map(JSON.parse);
  assert.equal(new Set(workers.map(worker => worker.branch)).size, 2);
  assert.equal(new Set(workers.map(worker => worker.cwd)).size, 2);
  assert.equal(readFileSync(join(repo, 'shared.txt'), 'utf8'), 'base\n');
  for (const [index, worker] of workers.entries()) {
    assert.equal(readFileSync(join(worker.cwd, 'shared.txt'), 'utf8'), (index ? 'two' : 'one') + '\n');
  }
  assert.ok(result.worktreeNotes.some(note => note.includes('receipt=')));
  console.log(`PASS: ${host} -> ${kind}: packaged MCP isolates two subprocess writers and retains branch/diff receipts (fake model CLI, not live attestation)`);
} finally {
  child.kill();
  rmSync(root, { recursive: true, force: true });
}
