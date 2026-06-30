/*
 * Session store for the design-and-ship annotate tool.
 * Adapted and trimmed from the Lavish session-store (MIT): no layout-warning state.
 * One JSON file holds every session, keyed by a sha256 prefix of the canonical doc path,
 * so the doc path itself is the session identity (no opaque ids). No em dashes (project rule).
 */
import crypto from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

export async function canonicalFile(file) {
  const absolute = path.resolve(file);
  return realpath(absolute);
}

export function sessionKey(file) {
  return crypto.createHash("sha256").update(file).digest("hex").slice(0, 16);
}

function normalizePrompt(prompt) {
  const normalized = {
    uid: String(prompt.uid || ""),
    prompt: String(prompt.prompt || ""),
    selector: String(prompt.selector || ""),
    tag: String(prompt.tag || ""),
    text: String(prompt.text || ""),
  };
  if (prompt.target && typeof prompt.target === "object" && !Array.isArray(prompt.target)) {
    normalized.target = JSON.parse(JSON.stringify(prompt.target));
  }
  return normalized;
}

export class SessionStore {
  constructor(file) {
    this.file = file;
  }

  async readState() {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8"));
      return { sessions: parsed.sessions || {} };
    } catch (error) {
      if (error && error.code === "ENOENT") return { sessions: {} };
      throw error;
    }
  }

  async writeState(state) {
    await writeFile(this.file, `${JSON.stringify(state, null, 2)}\n`);
  }

  async listSessions() {
    const state = await this.readState();
    return Object.values(state.sessions);
  }

  async findByKey(key) {
    const state = await this.readState();
    return state.sessions[key] || null;
  }

  async upsertSession(file, url) {
    const absolute = await canonicalFile(file);
    const key = sessionKey(absolute);
    const state = await this.readState();
    const existing = state.sessions[key] || {};
    const session = {
      key,
      file: absolute,
      url,
      status: existing.status === "ended" ? "open" : existing.status || "open",
      prompts: existing.prompts || [],
      chat: existing.chat || [],
      updated_at: new Date().toISOString(),
    };
    state.sessions[key] = session;
    await this.writeState(state);
    return session;
  }

  async queuePrompts(key, payload) {
    const state = await this.readState();
    const session = state.sessions[key];
    if (!session) return null;
    const prompts = Array.isArray(payload.prompts) ? payload.prompts.map(normalizePrompt) : [];
    const userMessages = prompts
      .filter((p) => p.tag === "message" && p.prompt)
      .map((p) => ({ role: "user", text: p.prompt, at: new Date().toISOString() }));
    session.prompts = [...(session.prompts || []), ...prompts];
    session.chat = [...(session.chat || []), ...userMessages];
    session.status = "feedback";
    session.updated_at = new Date().toISOString();
    await this.writeState(state);
    return session;
  }

  // Drain queued prompts for an agent poll. Prompts queued before an "end" still flush first;
  // the next poll then observes the ended status.
  async takeFeedback(key) {
    const state = await this.readState();
    const session = state.sessions[key];
    if (!session) return { status: "missing" };
    const prompts = session.prompts || [];
    if (prompts.length === 0) {
      return session.status === "ended" ? { status: "ended" } : { status: "waiting" };
    }
    const result = { status: "feedback", prompts };
    session.prompts = [];
    if (session.status !== "ended") session.status = "open";
    session.updated_at = new Date().toISOString();
    await this.writeState(state);
    return result;
  }

  async endSession(key) {
    const state = await this.readState();
    const session = state.sessions[key];
    if (!session) return null;
    session.status = "ended";
    session.updated_at = new Date().toISOString();
    await this.writeState(state);
    return session;
  }

  async addAgentReply(key, text) {
    const state = await this.readState();
    const session = state.sessions[key];
    if (!session) return null;
    session.chat = [...(session.chat || []), { role: "agent", text: String(text || ""), at: new Date().toISOString() }];
    session.updated_at = new Date().toISOString();
    await this.writeState(state);
    return session;
  }
}
