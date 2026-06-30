/*
 * Design-and-Ship annotate server.
 * A thin local loopback server that replicates the Lavish review loop with zero external
 * dependencies (Node built-in http + fs.watch instead of express + chokidar).
 *
 * It serves a design-doc HTML inside a sandboxed iframe (sandbox=allow-scripts allow-forms
 * allow-popups allow-downloads, deliberately WITHOUT allow-same-origin) with our SDK injected,
 * renders our own side panel (chat + queued annotations) styled to match design-and-ship,
 * queues annotations/chat, streams an SSE channel for live-reload + agent replies, exposes a
 * blocking long-poll endpoint, and live-reloads the iframe when the doc file changes on disk.
 *
 * Loopback only. Default port 4388 (override with DNS_ANNOTATE_PORT). Idle self-shutdown after
 * ~30 minutes with no browser (SSE) and no agent poll connected. No em dashes (project rule).
 */
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { watch } from "node:fs";
import http from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalFile, SessionStore, sessionKey } from "./store.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "public");

const DEFAULT_PORT = Number(process.env.DNS_ANNOTATE_PORT || 4388);
const IDLE_TIMEOUT_MS = (() => {
  const raw = (process.env.DNS_ANNOTATE_IDLE_MS || "").trim();
  if (raw === "0" || raw.toLowerCase() === "off") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 30 * 60_000;
})();
const HEARTBEAT_MS = 15_000;
const VERSION = "1";

function stateDir() {
  return process.env.DNS_ANNOTATE_STATE_DIR || path.join(homedir(), ".dns-annotate");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]);
}

function jsonScript(value) {
  return JSON.stringify(value)
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function displayPath(file, home = homedir()) {
  const f = file.replaceAll("\\", "/");
  const h = home.replaceAll("\\", "/");
  return h && f.startsWith(`${h}/`) ? `~/${f.slice(h.length + 1)}` : f;
}

function injectSdk(html) {
  const tag = `<script src="/sdk.js"></script>`;
  if (/<\/body\s*>/i.test(html)) return html.replace(/<\/body\s*>/i, `${tag}</body>`);
  return `${html}\n${tag}`;
}

function chromeHtml(session) {
  const sessionJson = jsonScript({ key: session.key, file: session.file, initialChat: session.chat || [] });
  const shown = displayPath(session.file);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Design and Ship - Annotate</title>
<link rel="stylesheet" href="/chrome.css">
</head>
<body>
<div class="bar">
  <div class="brand"><span class="dot"></span>Design and Ship <small>Annotate</small></div>
  <div class="spacer"></div>
  <button class="annotate-switch" id="annotation" type="button" aria-pressed="true">
    <span class="track" aria-hidden="true"><span class="knob"></span></span><span>Annotate</span>
  </button>
  <button class="bar-btn" id="copyPath" type="button" title="Copy path - ${escapeHtml(session.file)}">Copy path</button>
  <button class="bar-btn" id="reloadArtifact" type="button">Reload</button>
  <button class="bar-btn danger" id="end" type="button">End session</button>
</div>
<div class="layout">
  <div class="frame">
    <iframe id="artifact" sandbox="allow-scripts allow-forms allow-popups allow-downloads"
      data-artifact-src="/artifact/${session.key}/index.html"></iframe>
  </div>
  <aside class="panel">
    <h2>Conversation</h2>
    <div class="chat" id="chatLog"></div>
    <div class="composer">
      <div class="presence-banner" id="presenceBanner" hidden>Your agent is not polling yet. Click an element or send a note; it stays queued until the agent polls.</div>
      <div class="pills" id="annotationPills"></div>
      <textarea id="chatInput" placeholder="Write a message for the agent, or click an element in the doc to annotate it..."></textarea>
      <button class="button" id="send" type="button">Send to agent</button>
    </div>
  </aside>
</div>
<div class="ended-overlay" id="endedOverlay" hidden>
  <div class="ended-card">
    <div class="ended-title">Session ended. Return to your agent to continue.</div>
    <p class="ended-copy">${escapeHtml(shown)}</p>
  </div>
</div>
<script id="dns-session" type="application/json">${sessionJson}</script>
<script src="/chrome-client.js"></script>
</body>
</html>`;
}

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function contentType(file) {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
}

function resolveArtifactAsset(root, assetPath) {
  const file = path.resolve(root, assetPath);
  const relative = path.relative(root, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return file;
}

export async function serve({ port = DEFAULT_PORT, stateFile } = {}) {
  const store = new SessionStore(stateFile || path.join(stateDir(), "state.json"));
  const events = new EventEmitter();
  events.setMaxListeners(0);
  const watchers = new Map();
  const activePolls = new Map();
  const deliveredFeedback = new Set();
  const sseClients = new Set();
  let publicPort = port;

  function presence(key) {
    if (activePolls.has(key)) return "listening";
    if (deliveredFeedback.has(key)) return "working";
    return "waiting";
  }

  function setPollActive(key, active) {
    const before = presence(key);
    const count = activePolls.get(key) || 0;
    const next = active ? count + 1 : Math.max(0, count - 1);
    if (next === count) return;
    if (next === 0) activePolls.delete(key);
    else {
      activePolls.set(key, next);
      deliveredFeedback.delete(key);
    }
    const after = presence(key);
    if (after !== before) events.emit("agent-presence", key, after);
    refreshIdleTimer();
  }

  function markDelivered(key) {
    const before = presence(key);
    deliveredFeedback.add(key);
    const after = presence(key);
    if (after !== before) events.emit("agent-presence", key, after);
  }

  function clearDelivered(key) {
    const before = presence(key);
    deliveredFeedback.delete(key);
    const after = presence(key);
    if (after !== before) events.emit("agent-presence", key, after);
  }

  function watchSession(session) {
    if (watchers.has(session.key)) return;
    let timer = null;
    try {
      const watcher = watch(session.file, () => {
        clearTimeout(timer);
        timer = setTimeout(() => events.emit("reload", session.key), 100);
      });
      watcher.on("error", () => {});
      watchers.set(session.key, watcher);
    } catch {
      // Best effort: a doc that cannot be watched simply will not live-reload.
    }
  }

  async function readBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (!chunks.length) return {};
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return {};
    }
  }

  function sendJson(res, status, body) {
    const text = JSON.stringify(body);
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(text);
  }

  function sendText(res, status, type, body) {
    res.writeHead(status, { "content-type": type });
    res.end(body);
  }

  let idleTimer = null;
  let shuttingDown = false;
  function refreshIdleTimer() {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    if (shuttingDown || IDLE_TIMEOUT_MS == null) return;
    if (sseClients.size > 0 || activePolls.size > 0) return;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (!shuttingDown && sseClients.size === 0 && activePolls.size === 0) shutdown();
    }, IDLE_TIMEOUT_MS);
    idleTimer.unref?.();
  }

  let shutdownResolve;
  const done = new Promise((resolve) => {
    shutdownResolve = resolve;
  });

  function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    if (idleTimer) clearTimeout(idleTimer);
    for (const res of sseClients) {
      try {
        res.write("event: server-reload\ndata: {}\n\n");
        res.end();
      } catch {
        /* best effort */
      }
    }
    sseClients.clear();
    for (const w of watchers.values()) {
      try {
        w.close();
      } catch {
        /* best effort */
      }
    }
    watchers.clear();
    server.close(() => shutdownResolve());
    server.closeAllConnections?.();
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const pathname = decodeURIComponent(url.pathname);
      const method = req.method || "GET";

      if (pathname === "/health") return sendJson(res, 200, { ok: true, app: "dns-annotate", version: VERSION });

      if (pathname === "/shutdown" && method === "POST") {
        sendJson(res, 200, { status: "shutting-down" });
        setImmediate(shutdown);
        return;
      }

      // Static browser assets.
      if (method === "GET" && (pathname === "/sdk.js" || pathname === "/chrome-client.js" || pathname === "/chrome.css")) {
        const file = path.join(publicDir, pathname.slice(1));
        return sendText(res, 200, contentType(file), await readFile(file, "utf8"));
      }

      if (pathname === "/api/sessions" && method === "POST") {
        const body = await readBody(req);
        const file = await canonicalFile(body.file);
        const key = sessionKey(file);
        const sessionUrl = `http://127.0.0.1:${publicPort}/session/${key}`;
        const session = await store.upsertSession(file, sessionUrl);
        watchSession(session);
        return sendJson(res, 200, { key, file, url: sessionUrl, status: "opened" });
      }

      if (pathname === "/api/poll" && method === "GET") {
        return handlePoll(req, res, url);
      }

      let m;
      if ((m = pathname.match(/^\/api\/([^/]+)\/prompts$/)) && method === "POST") {
        const key = m[1];
        const body = await readBody(req);
        const session = await store.queuePrompts(key, body);
        if (!session) return sendJson(res, 404, { error: "session not found" });
        events.emit("feedback", key);
        return sendJson(res, 200, { status: "queued" });
      }

      if ((m = pathname.match(/^\/api\/([^/]+)\/agent-reply$/)) && method === "POST") {
        const key = m[1];
        const body = await readBody(req);
        const session = await store.addAgentReply(key, String(body.text || ""));
        if (!session) return sendJson(res, 404, { error: "session not found" });
        events.emit("agent-reply", key, String(body.text || ""));
        return sendJson(res, 200, { status: "sent" });
      }

      if ((m = pathname.match(/^\/api\/([^/]+)\/end$/)) && method === "POST") {
        const key = m[1];
        await store.endSession(key);
        clearDelivered(key);
        events.emit("ended", key);
        sendJson(res, 200, { status: "ended" });
        await maybeShutdown();
        return;
      }

      if (pathname === "/api/end" && method === "POST") {
        const body = await readBody(req);
        const file = await canonicalFile(body.file);
        const key = sessionKey(file);
        await store.endSession(key);
        clearDelivered(key);
        events.emit("ended", key);
        sendJson(res, 200, { status: "ended" });
        await maybeShutdown();
        return;
      }

      if ((m = pathname.match(/^\/session\/([^/]+)$/)) && method === "GET") {
        const session = await store.findByKey(m[1]);
        if (!session) return sendText(res, 404, "text/plain", "Session not found");
        watchSession(session);
        return sendText(res, 200, "text/html; charset=utf-8", chromeHtml(session));
      }

      if ((m = pathname.match(/^\/artifact\/([^/]+)\/index\.html$/)) && method === "GET") {
        const session = await store.findByKey(m[1]);
        if (!session) return sendText(res, 404, "text/plain", "Session not found");
        const html = await readFile(session.file, "utf8");
        return sendText(res, 200, "text/html; charset=utf-8", injectSdk(html));
      }

      if ((m = pathname.match(/^\/artifact\/([^/]+)\/(.+)$/)) && method === "GET") {
        const session = await store.findByKey(m[1]);
        if (!session) return sendText(res, 404, "text/plain", "Session not found");
        const root = path.dirname(session.file);
        const file = resolveArtifactAsset(root, m[2]);
        if (!file) return sendText(res, 403, "text/plain", "Forbidden");
        try {
          return sendText(res, 200, contentType(file), await readFile(file));
        } catch {
          return sendText(res, 404, "text/plain", "Not found");
        }
      }

      if ((m = pathname.match(/^\/events\/([^/]+)$/)) && method === "GET") {
        return handleSse(req, res, m[1]);
      }

      sendText(res, 404, "text/plain", "Not found");
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  async function handlePoll(req, res, url) {
    const file = await canonicalFile(String(url.searchParams.get("file") || ""));
    const key = sessionKey(file);
    const timeoutRaw = url.searchParams.get("timeoutMs");
    const timeoutMs = timeoutRaw === null ? null : Math.max(0, Math.min(Number(timeoutRaw) || 0, 2147483647));

    const immediate = await store.takeFeedback(key);
    if (immediate.status !== "waiting") {
      if (immediate.status === "feedback") markDelivered(key);
      return sendJson(res, 200, immediate);
    }

    const streaming = timeoutMs === null;
    let heartbeat = null;
    if (streaming) {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.write(" ");
      heartbeat = setInterval(() => {
        if (!res.writableEnded) res.write(" ");
      }, HEARTBEAT_MS);
      heartbeat.unref?.();
    }

    setPollActive(key, true);
    let cleaned = false;
    let responding = false;
    const timer = timeoutMs === null ? null : setTimeout(() => respond(), timeoutMs);

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      if (timer) clearTimeout(timer);
      if (heartbeat) clearInterval(heartbeat);
      events.off("feedback", onFeedback);
      events.off("ended", onFeedback);
      setPollActive(key, false);
    };

    const respond = async () => {
      if (responding || res.writableEnded) return;
      responding = true;
      try {
        const result = await store.takeFeedback(key);
        if (result.status === "feedback") markDelivered(key);
        if (streaming) res.end(JSON.stringify(result));
        else sendJson(res, 200, result);
      } finally {
        cleanup();
      }
    };

    const onFeedback = (changedKey) => {
      if (changedKey !== key || res.writableEnded) return;
      respond();
    };

    events.on("feedback", onFeedback);
    events.on("ended", onFeedback);
    req.on("close", cleanup);
  }

  async function handleSse(req, res, key) {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    sseClients.add(res);
    refreshIdleTimer();
    const session = await store.findByKey(key);

    const sendReload = (k) => {
      if (k === key) res.write("event: reload\ndata: {}\n\n");
    };
    const sendAgentReply = (k, text) => {
      if (k === key) res.write(`event: agent-reply\ndata: ${JSON.stringify({ text })}\n\n`);
    };
    const sendPresence = (k, state) => {
      if (k === key) res.write(`event: agent-presence\ndata: ${JSON.stringify({ state })}\n\n`);
    };

    res.write(`event: chat-sync\ndata: ${JSON.stringify({ chat: session?.chat || [] })}\n\n`);
    res.write(`event: agent-presence\ndata: ${JSON.stringify({ state: presence(key) })}\n\n`);

    events.on("reload", sendReload);
    events.on("agent-reply", sendAgentReply);
    events.on("agent-presence", sendPresence);
    req.on("close", () => {
      sseClients.delete(res);
      events.off("reload", sendReload);
      events.off("agent-reply", sendAgentReply);
      events.off("agent-presence", sendPresence);
      refreshIdleTimer();
    });
  }

  async function maybeShutdown() {
    if (sseClients.size > 0 || activePolls.size > 0) return;
    try {
      const sessions = await store.listSessions();
      if (sessions.every((s) => s.status === "ended")) setImmediate(shutdown);
    } catch {
      /* idle timer is the backstop */
    }
  }

  await new Promise((resolve, reject) => {
    server.listen(port, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });
  publicPort = server.address().port;
  refreshIdleTimer();

  return { port: publicPort, close: async () => { shutdown(); await done; }, done };
}

// Allow running the server directly: `node annotate/server.js`.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(stateDir(), { recursive: true });
  await serve({ port: DEFAULT_PORT });
  process.stderr.write(`[dns-annotate] server listening on http://127.0.0.1:${DEFAULT_PORT}\n`);
}
