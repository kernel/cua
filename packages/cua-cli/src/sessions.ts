import {
	type AgentMessage,
	InMemorySessionRepo,
	JsonlSessionRepo,
	NodeExecutionEnv,
	type Session,
	type SessionTreeEntry,
} from "@onkernel/cua-agent";
import type { BrowserSession } from "@onkernel/cua-translator";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/** Custom entry types we persist alongside the LLM transcript. */
export const CUA_BROWSER_ENTRY = "cua-browser";

export interface CuaBrowserMetadata {
	sessionId: string;
	liveUrl?: string;
	profileId?: string;
	createdAt: number;
}

interface SessionHeader {
	type: "session";
	id: string;
	timestamp: string;
	cwd: string;
	parentSession?: string;
}

export interface SessionInfo {
	path: string;
	id: string;
	cwd: string;
	name?: string;
	parentSessionPath?: string;
	created: Date;
	modified: Date;
	messageCount: number;
	firstMessage: string;
}

export interface CuaSessionState {
	env: NodeExecutionEnv;
	session: Session;
	resumed: boolean;
	priorMessageCount: number;
	getSessionFile(): string | undefined;
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
 * Open a harness-native session for the requested mode.
 *
 *   ephemeral=true  → in-memory, never touches disk.
 *   sessionPath set → attach to an existing session file.
 *   default         → create a fresh session in the resolved sessionDir.
 */
export async function openSession(opts: OpenSessionOptions): Promise<CuaSessionState> {
	const env = new NodeExecutionEnv({ cwd: opts.cwd });
	if (opts.ephemeral) {
		const repo = new InMemorySessionRepo();
		const session = await repo.create();
		const context = await session.buildContext();
		return {
			env,
			session,
			resumed: context.messages.length > 0,
			priorMessageCount: context.messages.length,
			getSessionFile: () => undefined,
		};
	}

	const dir = opts.sessionDir ?? defaultSessionDir();
	const repo = new JsonlSessionRepo({ sessionsRoot: dir });

	if (opts.sessionPath) {
		const metadata = await readSessionMetadata(resolveSessionPathArg(opts.cwd, opts.sessionPath));
		const session = await repo.open(metadata);
		const context = await session.buildContext();
		return {
			env,
			session,
			resumed: context.messages.length > 0,
			priorMessageCount: context.messages.length,
			getSessionFile: () => metadata.path,
		};
	}

	const session = await repo.create({ cwd: opts.cwd });
	const metadata = await session.getMetadata();
	const context = await session.buildContext();
	return {
		env,
		session,
		resumed: context.messages.length > 0,
		priorMessageCount: context.messages.length,
		getSessionFile: () => "path" in metadata ? metadata.path : undefined,
	};
}

/** List sessions for a cwd from the resolved sessions directory. */
export async function listSessions(cwd: string, sessionDir?: string): Promise<SessionInfo[]> {
	const dir = sessionDir ?? defaultSessionDir();
	const repo = new JsonlSessionRepo({ sessionsRoot: dir });
	const sessions = await repo.list({ cwd });
	return await Promise.all(sessions.map(async (metadata) => await toSessionInfo(repo, metadata)));
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
	if (trimmed.includes("/") || trimmed.endsWith(".jsonl")) {
		return resolveSessionPathArg(cwd, trimmed);
	}
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

/** Record browser metadata so resume can show what the previous session ran against. */
export async function appendBrowserMetadata(state: CuaSessionState, browser: BrowserSession): Promise<void> {
	const meta: CuaBrowserMetadata = {
		sessionId: browser.sessionId,
		liveUrl: browser.liveUrl,
		profileId: browser.profileId,
		createdAt: Date.now(),
	};
	try {
		await state.session.appendCustomEntry(CUA_BROWSER_ENTRY, meta);
	} catch {
		// non-fatal
	}
}

function resolveSessionPathArg(cwd: string, sessionPath: string): string {
	return isAbsolute(sessionPath) ? sessionPath : resolve(cwd, sessionPath);
}

function textFromAgentMessage(message: AgentMessage): string {
	if (message.role !== "user" && message.role !== "assistant") return "";
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(block): block is { type: "text"; text: string } =>
				typeof block === "object" && block !== null && block.type === "text" && typeof block.text === "string",
		)
		.map((block) => block.text)
		.join("\n");
}

async function readSessionMetadata(filePath: string): Promise<{
	id: string;
	createdAt: string;
	cwd: string;
	path: string;
	parentSessionPath?: string;
}> {
	const resolvedPath = resolve(filePath);
	const content = await readFile(resolvedPath, "utf8");
	const headerLine = content.split("\n").find((line) => line.trim().length > 0);
	if (!headerLine) {
		throw new Error(`invalid session file "${resolvedPath}": missing header`);
	}
	let header: SessionHeader;
	try {
		header = JSON.parse(headerLine) as SessionHeader;
	} catch {
		throw new Error(`invalid session file "${resolvedPath}": malformed header`);
	}
	if (header.type !== "session" || !header.id || !header.timestamp || !header.cwd) {
		throw new Error(`invalid session file "${resolvedPath}": malformed session metadata`);
	}
	return {
		id: header.id,
		createdAt: header.timestamp,
		cwd: header.cwd,
		path: resolvedPath,
		parentSessionPath: header.parentSession,
	};
}

async function toSessionInfo(
	repo: JsonlSessionRepo,
	metadata: {
		id: string;
		createdAt: string;
		cwd: string;
		path: string;
		parentSessionPath?: string;
	},
): Promise<SessionInfo> {
	const session = await repo.open(metadata);
	const branch = await session.getBranch();
	const messageEntries = branch.filter(
		(entry): entry is Extract<SessionTreeEntry, { type: "message" }> => entry.type === "message",
	);
	const firstMessage = messageEntries.find((entry) => entry.message.role === "user") ?? messageEntries[0];
	const messageText = firstMessage ? textFromAgentMessage(firstMessage.message).trim() : "";
	const fileStats = await stat(metadata.path);
	return {
		path: metadata.path,
		id: metadata.id,
		cwd: metadata.cwd,
		name: await session.getSessionName(),
		parentSessionPath: metadata.parentSessionPath,
		created: new Date(metadata.createdAt),
		modified: fileStats.mtime,
		messageCount: messageEntries.length,
		firstMessage: messageText,
	};
}
