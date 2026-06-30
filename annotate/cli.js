#!/usr/bin/env node
/*
 * Design-and-Ship annotate CLI.
 * Commands:
 *   open <file>                      spawn the detached server if needed, register the doc,
 *                                    print the local URL, and xdg-open it (unless --no-open)
 *   poll <file> [--agent-reply "t"]  block until annotations/chat arrive, print them as JSON
 *                                    to stdout; with --agent-reply, push a chat reply first
 *   end <file>                       end the session
 *   stop                             shut the server down
 *
 * Heartbeats and status go to stderr; stdout carries only the final JSON so it stays parseable.
 * Modeled on the Lavish CLI long-poll client. No em dashes anywhere (project rule).
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(here, "server.js");
const PORT = Number(process.env.DNS_ANNOTATE_PORT || 4388);
const BASE = `http://127.0.0.1:${PORT}`;

function stateDir() {
  return process.env.DNS_ANNOTATE_STATE_DIR || path.join(homedir(), ".dns-annotate");
}

function logErr(msg) {
  process.stderr.write(`${msg}\n`);
}

async function healthy() {
  try {
    const res = await fetch(`${BASE}/health`, { cache: "no-store" });
    if (!res.ok) return false;
    const body = await res.json();
    return body && body.app === "dns-annotate";
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await healthy()) return;
  await mkdir(stateDir(), { recursive: true });
  const child = spawn(process.execPath, [serverPath], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await healthy()) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("annotate server did not come up on " + BASE);
}

function parseFlags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--no-open") out.noOpen = true;
    else if (a === "--agent-reply") out.agentReply = args[++i] || "";
    else if (a === "--timeout-ms") out.timeoutMs = args[++i];
    else if (a.startsWith("--agent-reply=")) out.agentReply = a.slice("--agent-reply=".length);
    else if (a.startsWith("--timeout-ms=")) out.timeoutMs = a.slice("--timeout-ms=".length);
    else out._.push(a);
  }
  return out;
}

async function openCmd(flags) {
  const file = flags._[0];
  if (!file) throw new Error("usage: open <file>");
  const absolute = path.resolve(file);
  await ensureServer();
  const res = await fetch(`${BASE}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: absolute }),
  });
  if (!res.ok) throw new Error("failed to open session: " + res.status);
  const body = await res.json();
  process.stdout.write(body.url + "\n");
  logErr(`[dns-annotate] serving ${absolute}`);
  logErr(`[dns-annotate] open ${body.url} in a browser to annotate`);
  if (!flags.noOpen) {
    try {
      const child = spawn("xdg-open", [body.url], { detached: true, stdio: "ignore" });
      child.unref();
    } catch {
      /* headless environments simply skip the launch */
    }
  }
}

// Read the long-poll response. The server streams whitespace heartbeats while it waits, then
// ends with the final JSON, so accumulate the whole body and parse the trimmed result.
async function pollOnce(absolute, timeoutMs) {
  const params = new URLSearchParams({ file: absolute });
  if (timeoutMs !== undefined) params.set("timeoutMs", String(timeoutMs));
  const res = await fetch(`${BASE}/api/poll?${params.toString()}`, { cache: "no-store" });
  const text = await res.text();
  const trimmed = text.trim();
  if (!trimmed) return { status: "waiting" };
  return JSON.parse(trimmed);
}

async function pollCmd(flags) {
  const file = flags._[0];
  if (!file) throw new Error("usage: poll <file> [--agent-reply \"text\"] [--timeout-ms N]");
  const absolute = path.resolve(file);
  await ensureServer();

  if (flags.agentReply !== undefined) {
    const sessionRes = await fetch(`${BASE}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: absolute }),
    });
    if (!sessionRes.ok) throw new Error("failed to ensure session: " + sessionRes.status);
    const { key } = await sessionRes.json();
    const replyRes = await fetch(`${BASE}/api/${key}/agent-reply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: flags.agentReply }),
    });
    if (!replyRes.ok) throw new Error("failed to post agent reply: " + replyRes.status);
    logErr(`[dns-annotate] agent reply delivered to the side panel`);
  }

  logErr(`[dns-annotate] waiting for annotations on ${absolute} ... (Ctrl-C to stop)`);
  const heartbeat = setInterval(() => logErr(`[dns-annotate] still waiting for annotations...`), 60_000);
  heartbeat.unref?.();
  try {
    const result = await pollOnce(absolute, flags.timeoutMs);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } finally {
    clearInterval(heartbeat);
  }
}

async function endCmd(flags) {
  const file = flags._[0];
  if (!file) throw new Error("usage: end <file>");
  const absolute = path.resolve(file);
  if (!(await healthy())) {
    process.stdout.write(JSON.stringify({ status: "not-running" }) + "\n");
    return;
  }
  const res = await fetch(`${BASE}/api/end`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: absolute }),
  });
  process.stdout.write((await res.text()) + "\n");
}

async function stopCmd() {
  if (!(await healthy())) {
    process.stdout.write(JSON.stringify({ status: "not-running" }) + "\n");
    return;
  }
  try {
    await fetch(`${BASE}/shutdown`, { method: "POST" });
  } catch {
    /* the socket drops as the server exits */
  }
  process.stdout.write(JSON.stringify({ status: "stopped" }) + "\n");
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  switch (command) {
    case "open":
      return openCmd(flags);
    case "poll":
      return pollCmd(flags);
    case "end":
      return endCmd(flags);
    case "stop":
      return stopCmd();
    default:
      logErr("usage: node annotate/cli.js <open|poll|end|stop> <file> [flags]");
      process.exit(command ? 1 : 0);
  }
}

main().catch((error) => {
  logErr(`[dns-annotate] error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
