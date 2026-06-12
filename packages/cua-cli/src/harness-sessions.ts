import {
	type JsonlSessionMetadata,
	JsonlSessionRepo,
	NodeExecutionEnv,
	type Session,
} from "@onkernel/cua-agent";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve as resolvePath, join } from "node:path";

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

/**
 * Find the most recent session metadata for cwd. The pi `JsonlSessionRepo`
 * already orders by `createdAt` descending, but legacy `-c` semantics
 * resumed by last *modified* time so a session that was reopened and
 * appended to comes back first. We stat each file and prefer the newest
 * mtime; results that fail to stat fall back to `createdAt`.
 */
export async function findLatestSession(
	repo: JsonlSessionRepo,
	cwd: string,
): Promise<JsonlSessionMetadata | undefined> {
	const sessions = await listSessionsForCwd(repo, cwd);
	if (sessions.length === 0) return undefined;
	const ranked = await Promise.all(
		sessions.map(async (meta) => {
			try {
				const s = await stat(meta.path);
				return { meta, mtime: s.mtimeMs };
			} catch {
				return { meta, mtime: Number.NaN };
			}
		}),
	);
	ranked.sort((a, b) => {
		const am = Number.isFinite(a.mtime) ? a.mtime : -Infinity;
		const bm = Number.isFinite(b.mtime) ? b.mtime : -Infinity;
		if (am !== bm) return bm - am;
		return b.meta.createdAt.localeCompare(a.meta.createdAt);
	});
	return ranked[0]?.meta;
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
		const absolute = isAbsolute(trimmed) ? trimmed : resolvePath(cwd, trimmed);
		const direct = await readMetadataFromFile(absolute);
		if (direct) return direct;
		// Best-effort scan of the repo (no cwd filter) in case the path was
		// re-encoded somewhere (e.g. symlinks) and only matches a known session.
		const sessions = await repo.list();
		const match = sessions.find((m) => m.path === absolute);
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

/**
 * Load the header line of a jsonl session file from disk and return its
 * metadata, or undefined when the file is missing/empty/legacy. Used to
 * resolve `--session <path>` and named transcript_path entries that may
 * have been created from a different cwd (so the repo's per-cwd listing
 * wouldn't see them).
 */
export async function readMetadataFromFile(
	absolutePath: string,
): Promise<JsonlSessionMetadata | undefined> {
	try {
		const raw = await readFile(absolutePath, "utf8");
		const firstLine = raw.split("\n", 1)[0]?.trim();
		if (!firstLine) return undefined;
		const header = JSON.parse(firstLine) as {
			type?: string;
			version?: unknown;
			id?: unknown;
			timestamp?: unknown;
			cwd?: unknown;
			parentSession?: unknown;
		};
		if (header.type !== "session") return undefined;
		if (typeof header.id !== "string" || typeof header.timestamp !== "string" || typeof header.cwd !== "string") {
			return undefined;
		}
		return {
			id: header.id,
			createdAt: header.timestamp,
			cwd: header.cwd,
			path: absolutePath,
			...(typeof header.parentSession === "string" ? { parentSessionPath: header.parentSession } : {}),
		};
	} catch {
		return undefined;
	}
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
