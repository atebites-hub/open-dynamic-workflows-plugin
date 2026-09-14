// Short MCP requests control durable, process-supervised jobs. No new execution engine.
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync,
  renameSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
}
export interface WorkflowInput {
  cwd?: unknown; script?: unknown; scriptPath?: unknown; args?: unknown;
  resumeFromRunId?: unknown; routingPolicy?: unknown; isolation?: unknown;
  requestId?: unknown; maxSeconds?: unknown;
}
type State = "queued" | "running" | "cancelling" | "completed" | "failed" | "cancelled" | "timed_out" | "interrupted";
interface Job {
  jobId: string; cwd: string; state: State; createdAt: string; updatedAt: string;
  deadlineAt: string; inputHash: string; supervisorPid?: number; runId?: string;
  agentCount: number; finishedAgents: number; failedAgents: number;
  result?: Record<string, unknown>; error?: string;
  cleanup?: { method: string; complete: boolean; error?: string };
}
interface Request {
  workflow: WorkflowInput; sandboxCwd?: unknown;
}
type Execute = (input: WorkflowInput, signal: AbortSignal, sandboxCwd: unknown, onEvent: (event: unknown) => void) => Promise<ToolResult>;
const TERMINAL = new Set<State>(["completed", "failed", "cancelled", "timed_out", "interrupted"]);
const JOB_ID = /^(?:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|req-[0-9a-f]{64})$/;
const GRACE_MS = 5000;
const PROCESS_MARKER = "ODW_JOB_PROCESS_TOKEN";
const now = () => new Date().toISOString();
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));

// Cursor's Linux Shell tool creates a separate session. A process-group kill
// alone cannot reach it after the CLI exits. Match a fresh, supervisor-owned
// marker, never a cwd, command name, stored PID or client-supplied token.
function markedProcess(pid: number, token: string): string | undefined {
  try {
    if (pid === process.pid || statSync(`/proc/${pid}`).uid !== process.getuid!()) return;
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
    if (fields[0] === "Z" || fields[0] === "X") return;
    const environment = readFileSync(`/proc/${pid}/environ`, "utf8");
    if (environment.split("\0").includes(`${PROCESS_MARKER}=${token}`)) return fields[19];
  } catch (error) {
    // Protected entries are not proven job-owned. Never signal them, and do not
    // make an unrelated process's visibility a prerequisite for job completion.
    // Signal failures for positively marked processes still fail closed below.
    if (!["ENOENT", "ESRCH", "EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
  }
}

async function cleanupMarkedProcesses(token: string): Promise<NonNullable<Job["cleanup"]>> {
  const method = process.platform === "linux" ? "process-group-and-linux-job-marker" : "process-group";
  if (process.platform !== "linux") return { method, complete: true };
  // ponytail: a bounded /proc sweep, not a process daemon or security sandbox.
  // The marker survives reparenting; starttime and UID are rechecked before kill.
  const deadline = Date.now() + GRACE_MS;
  try {
    while (true) {
      const owned = readdirSync("/proc").filter(name => /^[1-9][0-9]*$/.test(name))
        .map(name => ({ pid: Number(name), start: markedProcess(Number(name), token) }))
        .filter(entry => entry.start !== undefined);
      if (!owned.length) return { method, complete: true };
      if (Date.now() >= deadline) throw new Error("Job-marked processes remain after cleanup deadline");
      for (const { pid, start } of owned) {
        if (markedProcess(pid, token) !== start) continue;
        try { process.kill(pid, "SIGKILL"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
      }
      await new Promise(resolveWait => setTimeout(resolveWait, 25));
    }
  } catch (error) { return { method, complete: false, error: String(error) }; }
}

function atomicJson(file: string, value: unknown): void {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(value) + "\n", { flag: "wx", mode: 0o600 });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function rootFor(cwd: unknown, create = false): { cwd: string; root: string } {
  if (typeof cwd !== "string" || !isAbsolute(cwd)) throw new Error("background workflow cwd must be absolute");
  const canonical = realpathSync(cwd);
  const root = join(canonical, ".odw", ".jobs");
  if (create) mkdirSync(root, { recursive: true, mode: 0o700 });
  if (realpathSync(root) !== root) throw new Error("background job storage must not use symlinks");
  return { cwd: canonical, root };
}

function locate(cwd: unknown, jobId: unknown): { directory: string; job: Job } {
  if (typeof jobId !== "string" || !JOB_ID.test(jobId)) throw new Error("invalid background jobId");
  const owner = rootFor(cwd);
  const directory = join(owner.root, jobId);
  if (realpathSync(directory) !== directory) throw new Error("background job directory must not use symlinks");
  const job = readJson(join(directory, "state.json")) as Job;
  if (job.jobId !== jobId || job.cwd !== owner.cwd) throw new Error("background job ownership mismatch");
  return { directory, job };
}

function readJob(cwd: unknown, jobId: unknown): Job {
  const { job } = locate(cwd, jobId);
  if (!TERMINAL.has(job.state)) {
    let missing = false;
    if (job.supervisorPid !== undefined) {
      try { process.kill(job.supervisorPid, 0); }
      catch (error) { missing = (error as NodeJS.ErrnoException).code === "ESRCH"; }
    }
    if (missing || Date.now() > Date.parse(job.deadlineAt) + 2 * GRACE_MS + 5000) {
      return { ...job, state: "interrupted", error: "Job supervisor stopped without a terminal receipt; inspect retained artifacts. No automatic replay." };
    }
  }
  return job;
}

function reply(job: Job): ToolResult {
  const { supervisorPid: _pid, inputHash: _hash, ...publicJob } = job;
  const terminal = TERMINAL.has(job.state);
  return {
    content: [{ type: "text", text: JSON.stringify({
      ...publicJob, terminal, ok: terminal ? job.state === "completed" : null,
      ...(!terminal ? { next: { tool: "workflow_status", arguments: { cwd: job.cwd, jobId: job.jobId, waitSeconds: 10 } } } : {}),
    }) }],
    isError: terminal && job.state !== "completed",
  };
}

export async function startBackground(
  input: WorkflowInput, entrypoint: string, signal?: AbortSignal, sandboxCwd?: unknown,
): Promise<ToolResult> {
  if (process.platform === "win32") throw new Error("Grok Bot background jobs require POSIX process groups");
  const maxSeconds = input.maxSeconds ?? 1800;
  if (typeof maxSeconds !== "number" || !Number.isInteger(maxSeconds) || maxSeconds < 1 || maxSeconds > 28800) {
    throw new Error("maxSeconds must be an integer from 1 to 28800 (default 1800)");
  }
  const requestId = input.requestId;
  if (requestId !== undefined && (typeof requestId !== "string" || !requestId.trim() || requestId.length > 128)) {
    throw new Error("requestId must be a nonempty string of at most 128 characters");
  }
  if (signal?.aborted) throw new Error("workflow start cancelled before acceptance");
  const owner = rootFor(input.cwd, true);
  const { maxSeconds: _limit, requestId: _request, ...workflow } = input;
  workflow.cwd = owner.cwd;
  if (typeof workflow.scriptPath === "string") {
    workflow.script = readFileSync(resolve(owner.cwd, workflow.scriptPath), "utf8");
    delete workflow.scriptPath;
  }
  const request: Request = { workflow, ...(sandboxCwd !== undefined ? { sandboxCwd } : {}) };
  const inputHash = hash(JSON.stringify({ request, maxSeconds }));
  const jobId = requestId === undefined ? randomUUID() : `req-${hash(requestId as string)}`;
  const directory = join(owner.root, jobId);
  try { mkdirSync(directory, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST" || requestId === undefined) throw error;
    const existing = readJob(owner.cwd, jobId);
    if (existing.inputHash !== inputHash) throw new Error("requestId was already used with different workflow inputs");
    return reply(existing);
  }
  const createdAt = now();
  const job: Job = {
    jobId, cwd: owner.cwd, state: "queued", createdAt, updatedAt: createdAt,
    deadlineAt: new Date(Date.now() + maxSeconds * 1000).toISOString(), inputHash,
    agentCount: 0, finishedAgents: 0, failedAgents: 0,
  };
  atomicJson(join(directory, "request.json"), request);
  atomicJson(join(directory, "state.json"), job);
  const log = openSync(join(directory, "runner.log"), "a", 0o600);
  try {
    await new Promise<void>((resolveSpawn, rejectSpawn) => {
      const supervisor = spawn(process.execPath, [entrypoint, "--odw-job-supervisor", directory], {
        cwd: owner.cwd, env: process.env, detached: true, stdio: ["ignore", log, log],
      });
      supervisor.once("error", rejectSpawn);
      supervisor.once("spawn", () => { supervisor.unref(); resolveSpawn(); });
    });
  } catch (error) {
    job.state = "failed"; job.error = String(error); job.updatedAt = now();
    atomicJson(join(directory, "state.json"), job);
    return reply(job);
  } finally { closeSync(log); }
  // Only a cancellation before the acceptance response affects startup. Later
  // expired status/start requests are not explicit workflow cancellation.
  if (signal?.aborted) return cancelBackground({ cwd: owner.cwd, jobId });
  return reply(job);
}

export async function statusBackground(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
  const waitSeconds = args.waitSeconds ?? 10;
  if (typeof waitSeconds !== "number" || !Number.isInteger(waitSeconds) || waitSeconds < 0 || waitSeconds > 20) {
    throw new Error("waitSeconds must be an integer from 0 to 20");
  }
  const deadline = Date.now() + waitSeconds * 1000;
  let job = readJob(args.cwd, args.jobId);
  while (!TERMINAL.has(job.state) && Date.now() < deadline) {
    if (signal?.aborted) throw new Error("status request cancelled; background job is unchanged");
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
    job = readJob(args.cwd, args.jobId);
  }
  return reply(job);
}

export function cancelBackground(args: Record<string, unknown>): ToolResult {
  const { directory, job } = locate(args.cwd, args.jobId);
  if (TERMINAL.has(job.state)) return reply(job);
  try { writeFileSync(join(directory, "cancel"), "cancel\n", { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  return reply({ ...readJob(args.cwd, args.jobId), state: "cancelling" });
}

function parseResult(result: ToolResult): Record<string, unknown> {
  let summary: Record<string, unknown>;
  try { summary = JSON.parse(result.content[0]?.text ?? "{}"); }
  catch { summary = { error: result.content[0]?.text ?? "Missing workflow result" }; }
  const accepted = !result.isError && summary.ok === true && summary.durable === true &&
    summary.failedAgents === 0 && summary.failedWorkflows === 0;
  return { ...summary, scriptOk: summary.ok ?? false, ok: accepted };
}

export async function superviseBackground(directory: string, entrypoint: string): Promise<void> {
  const request = readJson(join(directory, "request.json")) as Request;
  const stateFile = join(directory, "state.json");
  const job = readJson(stateFile) as Job;
  locate(request.workflow.cwd, job.jobId);
  job.supervisorPid = process.pid; job.state = "running";
  const processToken = randomUUID();
  const persist = () => { job.updatedAt = now(); atomicJson(stateFile, job); };
  persist();
  await new Promise<void>((resolveDone) => {
    let child: ChildProcess | undefined;
    let stopped: State | undefined;
    let finished = false;
    let tick: NodeJS.Timeout | undefined;
    let grace: NodeJS.Timeout | undefined;
    const killOwnedGroup = () => {
      if (!child?.pid) return;
      // This is a live ChildProcess owned by this supervisor, never a client-
      // supplied or recovered PID. Detached Shell sessions are cleaned below.
      try { process.kill(-child.pid, "SIGKILL"); }
      catch { try { child.kill("SIGKILL"); } catch { /* already stopped */ } }
    };
    const finish = (result?: ToolResult, error?: string) => {
      if (finished) return;
      finished = true;
      if (tick) clearInterval(tick);
      if (grace) clearTimeout(grace);
      if (result) job.result = parseResult(result);
      if (error) job.error = error;
      killOwnedGroup();
      void cleanupMarkedProcesses(processToken).then(cleanup => {
        job.cleanup = cleanup;
        job.state = cleanup.complete ? stopped ?? (job.result?.ok === true ? "completed" : "failed") : "interrupted";
        if (!cleanup.complete) {
          job.error = [job.error, cleanup.error].filter(Boolean).join("; ");
          if (job.result) job.result.ok = false;
        }
        // A terminal receipt is published only after cleanup, not before it.
        try { persist(); }
        catch (failure) { console.error("[odw] terminal job receipt failed:", failure); }
        finally { resolveDone(); }
      });
    };
    const stop = (reason: State) => {
      if (finished || stopped) return;
      stopped = reason; job.state = "cancelling";
      try { persist(); } catch (error) { console.error(error); }
      if (!child) { finish(undefined, reason); return; }
      if (child.connected) child.send({ kind: "cancel" }, () => {});
      grace = setTimeout(() => finish(undefined, `${reason}: runtime stopped after cleanup grace`), GRACE_MS);
    };
    process.once("SIGTERM", () => stop("interrupted"));
    process.once("SIGINT", () => stop("interrupted"));
    if (existsSync(join(directory, "cancel"))) { stop("cancelled"); return; }
    if (Date.now() >= Date.parse(job.deadlineAt)) { stop("timed_out"); return; }
    child = spawn(process.execPath, [entrypoint, "--odw-job-execute", directory], {
      cwd: job.cwd, env: { ...process.env, [PROCESS_MARKER]: processToken }, detached: true,
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    child.on("message", (message: unknown) => {
      if (finished || !message || typeof message !== "object") return;
      const data = message as { kind?: string; event?: { type?: string; runId?: string; ok?: boolean }; result?: ToolResult };
      if (data.kind === "event" && data.event) {
        const event = data.event;
        if (event.type === "run_start") job.runId = event.runId;
        if (event.type === "agent_start") job.agentCount++;
        if (event.type === "agent_end") { job.finishedAgents++; if (!event.ok) job.failedAgents++; }
        try { persist(); } catch (error) { stop("interrupted"); console.error(error); }
      } else if (data.kind === "result" && data.result) {
        if (!stopped && existsSync(join(directory, "cancel"))) stopped = "cancelled";
        if (!stopped && Date.now() >= Date.parse(job.deadlineAt)) stopped = "timed_out";
        finish(data.result);
      }
    });
    child.once("error", error => finish(undefined, String(error)));
    child.once("close", (code, signal) => finish(undefined, `Runtime exited without result: code=${code}, signal=${signal}`));
    tick = setInterval(() => {
      if (existsSync(join(directory, "cancel"))) stop("cancelled");
      else if (Date.now() >= Date.parse(job.deadlineAt)) stop("timed_out");
      if (!finished && Date.now() - Date.parse(job.updatedAt) >= 1000) {
        try { persist(); } catch (error) { stop("interrupted"); console.error(error); }
      }
    }, 100);
  });
}

export async function executeBackground(directory: string, execute: Execute): Promise<void> {
  if (!process.send) throw new Error("Background runtime requires its supervisor IPC channel");
  const request = readJson(join(directory, "request.json")) as Request;
  const job = readJson(join(directory, "state.json")) as Job;
  locate(request.workflow.cwd, job.jobId);
  const controller = new AbortController();
  process.on("message", message => {
    if (message && typeof message === "object" && (message as { kind?: string }).kind === "cancel") controller.abort();
  });
  process.once("disconnect", () => {
    controller.abort();
    setTimeout(() => { try { process.kill(-process.pid, "SIGKILL"); } catch { process.exit(1); } }, GRACE_MS);
  });
  const send = (message: unknown) => { if (process.connected) process.send?.(message, () => {}); };
  try {
    const result = await execute(request.workflow, controller.signal, request.sandboxCwd, event => send({ kind: "event", event }));
    send({ kind: "result", result });
  } catch (error) {
    send({ kind: "result", result: { content: [{ type: "text", text: String(error) }], isError: true } });
  }
  // Keep IPC alive until the supervisor durably records the result and tears
  // down this owned process group (including any leftover CLI descendants).
}
