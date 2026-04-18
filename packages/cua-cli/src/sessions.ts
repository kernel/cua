import type { Agent, AgentMessage } from "@mariozechner/pi-agent-core";
import { SessionManager, type SessionInfo } from "@mariozechner/pi-coding-agent";
import type { BrowserSession } from "@onkernel/cua-translator";
import { homedir } from "node:os";
import { join } from "node:path";

/** Custom entry types we persist alongside the LLM transcript. */
export const CUA_BROWSER_ENTRY = "cua-browser";

export interface CuaBrowserMetadata {
	sessionId: string;
	liveUrl?: string;
	profileId?: string;
	createdAt: number;
}

/** Resolve the default sessions directory: $XDG_DATA_HOME/cua/sessions or ~/.local/share/cua/sessions. */
export function defaultSessionDir(): string {
	const xdg = process.env.XDG_DATA_HOME;
	if (xdg) return join(xdg, "cua", "sessions");
	return join(homedir(), ".local", "share", "cua", "sessions");
}

export interface OpenSessionOptions {
	cwd: string;
	/** Override the directory where session files live. */
	sessionDir?: string;
	/** Resolved path of an existing session to attach to. */
	sessionPath?: string;
	/** Skip persistence entirely (in-memory only). */
	ephemeral?: boolean;
}

/**
 * Open a SessionManager for the requested mode.
 *
 *   ephemeral=true  → in-memory, never touches disk.
 *   sessionPath set → attach to an existing session file.
 *   default         → create a fresh session in the resolved sessionDir.
 */
export function openSession(opts: OpenSessionOptions): SessionManager {
	if (opts.ephemeral) {
		return SessionManager.inMemory(opts.cwd);
	}
	const dir = opts.sessionDir ?? defaultSessionDir();
	const sm = SessionManager.create(opts.cwd, dir);
	if (opts.sessionPath) {
		sm.setSessionFile(opts.sessionPath);
	}
	return sm;
}

/** List sessions for a cwd from the resolved sessions directory. */
export function listSessions(cwd: string, sessionDir?: string): Promise<SessionInfo[]> {
	const dir = sessionDir ?? defaultSessionDir();
	return SessionManager.list(cwd, dir);
}

/**
 * Resolve a session reference. Accepts:
 *   - absolute or relative path to an existing session file
 *   - `latest` -> most-recent session for cwd
 *   - any other string -> matched as a prefix against session ids
 */
export async function resolveSessionPath(input: string, cwd: string, sessionDir?: string): Promise<string> {
	const trimmed = input.trim();
	if (!trimmed) throw new Error("session reference is empty");
	if (trimmed.includes("/") || trimmed.endsWith(".jsonl")) return trimmed;
	const sessions = await listSessions(cwd, sessionDir);
	if (sessions.length === 0) throw new Error("no sessions found");
	if (trimmed === "latest") {
		const latest = [...sessions].sort((a, b) => b.modified.getTime() - a.modified.getTime())[0];
		return latest!.path;
	}
	const matches = sessions.filter((s) => s.id.startsWith(trimmed));
	if (matches.length === 0) throw new Error(`no session matches "${trimmed}"`);
	if (matches.length > 1) {
		throw new Error(`ambiguous session prefix "${trimmed}" (${matches.length} matches)`);
	}
	return matches[0]!.path;
}

/** Find the most recent session for cwd, or undefined when none exists. */
export async function findLatestSession(cwd: string, sessionDir?: string): Promise<SessionInfo | undefined> {
	const sessions = await listSessions(cwd, sessionDir);
	if (sessions.length === 0) return undefined;
	return [...sessions].sort((a, b) => b.modified.getTime() - a.modified.getTime())[0];
}

/**
 * Subscribe to the agent and persist user/assistant/toolResult messages
 * to the SessionManager as they complete. Returns an unsubscribe.
 */
export function persistAgentEvents(agent: Agent, sm: SessionManager): () => void {
	return agent.subscribe((event) => {
		if (event.type !== "message_end") return;
		const msg = event.message as AgentMessage;
		if (msg.role !== "user" && msg.role !== "assistant" && msg.role !== "toolResult") return;
		try {
			sm.appendMessage(msg as never);
		} catch {
			// ignore single-message persistence failures
		}
	});
}

/** Replay a previously persisted session into a fresh agent's transcript. */
export function seedAgentFromSession(agent: Agent, sm: SessionManager): void {
	const ctx = sm.buildSessionContext();
	if (ctx.messages.length === 0) return;
	agent.state.messages = ctx.messages;
}

/** Record browser metadata so resume can show what the previous session ran against. */
export function appendBrowserMetadata(sm: SessionManager, browser: BrowserSession): void {
	const meta: CuaBrowserMetadata = {
		sessionId: browser.sessionId,
		liveUrl: browser.liveUrl,
		profileId: browser.profileId,
		createdAt: Date.now(),
	};
	try {
		sm.appendCustomEntry(CUA_BROWSER_ENTRY, meta);
	} catch {
		// non-fatal
	}
}

export type { SessionInfo };
