import {
	type JsonlSessionMetadata,
	JsonlSessionRepo,
	NodeExecutionEnv,
	type Session,
} from "@onkernel/cua-agent";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolve the default sessions directory: `$XDG_DATA_HOME/cua/sessions`
 * (or `~/.local/share/cua/sessions`).
 */
export function defaultSessionsRoot(): string {
	const xdg = process.env.XDG_DATA_HOME;
	if (xdg) return join(xdg, "cua", "sessions");
	return join(homedir(), ".local", "share", "cua", "sessions");
}

/** Build a `JsonlSessionRepo` rooted at the resolved sessions directory. */
export function createSessionRepo(sessionsRoot?: string): JsonlSessionRepo {
	const root = sessionsRoot ?? defaultSessionsRoot();
	return new JsonlSessionRepo({
		fs: new NodeExecutionEnv({ cwd: process.cwd() }),
		sessionsRoot: root,
	});
}

export interface SessionInfo {
	metadata: JsonlSessionMetadata;
	mtimeMs?: number;
}

/** List sessions for a cwd; legacy / malformed files are skipped. */
export async function listSessionsForCwd(
	repo: JsonlSessionRepo,
	cwd: string,
): Promise<JsonlSessionMetadata[]> {
	const all = await repo.list({ cwd });
	return all;
}

/** Find the most recent session metadata for cwd (lexicographic by id; uuidv7 ids sort by creation). */
export async function findLatestSession(
	repo: JsonlSessionRepo,
	cwd: string,
): Promise<JsonlSessionMetadata | undefined> {
	const sessions = await listSessionsForCwd(repo, cwd);
	if (sessions.length === 0) return undefined;
	return [...sessions].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

/**
 * Resolve a `--session <ref>` argument. Accepts:
 *   - an absolute or relative path to an existing session file
 *   - `latest` for the most recent session for cwd
 *   - any other string as a prefix matched against session ids
 */
export async function resolveSessionRef(
	repo: JsonlSessionRepo,
	cwd: string,
	ref: string,
): Promise<JsonlSessionMetadata> {
	const trimmed = ref.trim();
	if (!trimmed) throw new Error("session reference is empty");
	if (trimmed.includes("/") || trimmed.endsWith(".jsonl")) {
		const sessions = await listSessionsForCwd(repo, cwd);
		const match = sessions.find((m) => m.path === trimmed);
		if (match) return match;
		throw new Error(`no session at "${trimmed}"`);
	}
	if (trimmed === "latest") {
		const latest = await findLatestSession(repo, cwd);
		if (!latest) throw new Error("no sessions found");
		return latest;
	}
	const sessions = await listSessionsForCwd(repo, cwd);
	const matches = sessions.filter((s) => s.id.startsWith(trimmed));
	if (matches.length === 0) throw new Error(`no session matches "${trimmed}"`);
	if (matches.length > 1) throw new Error(`ambiguous session prefix "${trimmed}" (${matches.length} matches)`);
	return matches[0]!;
}

/** Open (resume) a session by metadata. */
export function openSession(repo: JsonlSessionRepo, metadata: JsonlSessionMetadata): Promise<Session<JsonlSessionMetadata>> {
	return repo.open(metadata);
}

/** Create a brand-new session for cwd. */
export function createSession(repo: JsonlSessionRepo, cwd: string): Promise<Session<JsonlSessionMetadata>> {
	return repo.create({ cwd });
}

/** Custom entry type used to record the Kernel browser the session ran against. */
export const CUA_BROWSER_ENTRY = "cua-browser";

export interface CuaBrowserEntryData {
	sessionId: string;
	liveUrl?: string;
	profileId?: string;
	createdAt: number;
}

/** Append a browser-metadata custom entry to the session. */
export async function appendBrowserEntry(
	session: Session,
	data: CuaBrowserEntryData,
): Promise<void> {
	try {
		await session.appendCustomEntry(CUA_BROWSER_ENTRY, data);
	} catch {
		// best-effort; never block a run on bookkeeping
	}
}
