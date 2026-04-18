import { browserSession, type BrowserSession } from "@onkernel/cua-translator";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Config } from "./config.js";

/**
 * Named sessions: durable, slug-keyed pointers to a Kernel cloud browser
 * session that can be reused across `cua` invocations (e.g. `cua -s login
 * open ...` then `cua -s login click ...`).
 *
 * The browser itself lives server-side on Kernel. We don't run a local
 * daemon — when the slug is referenced again we just call
 * `client.browsers.retrieve(...)` to verify the session is still alive
 * and then use its id directly.
 */

export interface NamedSessionMetadata {
	name: string;
	kernel_session_id: string;
	live_url?: string;
	profile_id?: string;
	transcript_path?: string;
	config_profile?: string;
	created_at: number;
}

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function namedSessionsDir(): string {
	const xdg = process.env.XDG_DATA_HOME;
	if (xdg) return join(xdg, "cua", "named-sessions");
	return join(homedir(), ".local", "share", "cua", "named-sessions");
}

function sessionFilePath(name: string): string {
	return join(namedSessionsDir(), `${name}.json`);
}

export function validateSlug(name: string): void {
	if (!SLUG_PATTERN.test(name)) {
		throw new Error(
			`invalid session name "${name}": must match ${SLUG_PATTERN} (lowercase a-z, 0-9, hyphens; 1-63 chars; cannot start with a hyphen)`,
		);
	}
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

export async function readNamedSession(name: string): Promise<NamedSessionMetadata | undefined> {
	const path = sessionFilePath(name);
	if (!(await fileExists(path))) return undefined;
	const raw = await readFile(path, "utf8");
	return JSON.parse(raw) as NamedSessionMetadata;
}

export async function writeNamedSession(meta: NamedSessionMetadata): Promise<string> {
	validateSlug(meta.name);
	const path = sessionFilePath(meta.name);
	await mkdir(namedSessionsDir(), { recursive: true });
	await writeFile(path, JSON.stringify(meta, null, 2) + "\n", { mode: 0o600 });
	return path;
}

export async function deleteNamedSession(name: string): Promise<boolean> {
	const path = sessionFilePath(name);
	if (!(await fileExists(path))) return false;
	await unlink(path);
	return true;
}

export async function listNamedSessions(): Promise<NamedSessionMetadata[]> {
	const dir = namedSessionsDir();
	if (!(await fileExists(dir))) return [];
	const entries = await readdir(dir);
	const out: NamedSessionMetadata[] = [];
	for (const entry of entries) {
		if (!entry.endsWith(".json")) continue;
		try {
			const raw = await readFile(join(dir, entry), "utf8");
			out.push(JSON.parse(raw) as NamedSessionMetadata);
		} catch {
			// skip unreadable / malformed entries
		}
	}
	out.sort((a, b) => b.created_at - a.created_at);
	return out;
}

/**
 * Provision a fresh Kernel browser session and persist a named-session
 * metadata file pointing at it. The transcript path is recorded later
 * by the caller (after `openSession` decides where to write).
 */
export async function startNamedSession(args: {
	name: string;
	cfg: Config;
	configProfile?: string;
	browserProfile?: string;
	browserTimeoutSeconds?: number;
	saveProfileChanges?: boolean;
}): Promise<{ meta: NamedSessionMetadata; metadataPath: string; browser: BrowserSession }> {
	validateSlug(args.name);
	const existing = await readNamedSession(args.name);
	if (existing) {
		throw new Error(
			`named session "${args.name}" already exists (kernel_session_id=${existing.kernel_session_id}). Run \`cua session stop ${args.name}\` first.`,
		);
	}

	const browser = await browserSession.open({
		apiKey: args.cfg.kernelApiKey,
		baseUrl: args.cfg.kernelBaseUrl || undefined,
		timeoutSeconds: args.browserTimeoutSeconds,
		profileSelector: args.browserProfile,
		saveChanges: args.saveProfileChanges,
	});

	const meta: NamedSessionMetadata = {
		name: args.name,
		kernel_session_id: browser.sessionId,
		live_url: browser.liveUrl,
		profile_id: browser.profileId,
		config_profile: args.configProfile,
		created_at: Date.now(),
	};
	const metadataPath = await writeNamedSession(meta);
	return { meta, metadataPath, browser };
}

/**
 * Attach to a previously-started named session. Performs a Kernel
 * liveness check (`client.browsers.retrieve`) before returning so the
 * caller can fail fast with a clear error if the server-side session has
 * timed out or been deleted.
 */
export async function attachNamedSession(args: {
	name: string;
	cfg: Config;
}): Promise<{ meta: NamedSessionMetadata; browser: BrowserSession }> {
	const meta = await readNamedSession(args.name);
	if (!meta) {
		throw new Error(
			`unknown named session "${args.name}". Run \`cua session list\` to see available sessions, or \`cua session start ${args.name}\` to create one.`,
		);
	}

	const tentative = browserSession.attach({
		apiKey: args.cfg.kernelApiKey,
		baseUrl: args.cfg.kernelBaseUrl || undefined,
		sessionId: meta.kernel_session_id,
		liveUrl: meta.live_url,
		profileId: meta.profile_id,
	});

	let alive = false;
	let liveError: Error | undefined;
	try {
		const fresh = await tentative.client.browsers.retrieve(meta.kernel_session_id);
		const deletedAt = (fresh as { deleted_at?: unknown } | undefined)?.deleted_at;
		alive = !deletedAt;
	} catch (err) {
		liveError = err instanceof Error ? err : new Error(String(err));
		const status = (liveError as { status?: unknown }).status;
		if (status === 404) {
			alive = false;
		} else {
			throw new Error(
				`liveness check for named session "${args.name}" failed: ${liveError.message}`,
				{ cause: liveError },
			);
		}
	}

	if (!alive) {
		throw new Error(
			`named session "${args.name}" is no longer alive on Kernel (browser timed out or was deleted). Run \`cua session stop ${args.name} && cua session start ${args.name}\` to provision a fresh one.`,
		);
	}

	return { meta, browser: tentative };
}

/**
 * Tear down a named session: delete the Kernel browser server-side and
 * remove the local metadata file. Returns true if the metadata existed.
 */
export async function stopNamedSession(args: {
	name: string;
	cfg: Config;
}): Promise<{ existed: boolean; kernelDeleted: boolean }> {
	const meta = await readNamedSession(args.name);
	if (!meta) return { existed: false, kernelDeleted: false };

	const handle = browserSession.attach({
		apiKey: args.cfg.kernelApiKey,
		baseUrl: args.cfg.kernelBaseUrl || undefined,
		sessionId: meta.kernel_session_id,
	});

	let kernelDeleted = false;
	try {
		await handle.client.browsers.deleteByID(meta.kernel_session_id);
		kernelDeleted = true;
	} catch (err) {
		const status = (err as { status?: unknown })?.status;
		if (status !== 404) {
			throw new Error(
				`failed to delete Kernel browser ${meta.kernel_session_id} for named session "${args.name}": ${(err as Error).message}`,
				{ cause: err },
			);
		}
		// 404 → server-side session already gone, that's fine.
	}

	await deleteNamedSession(args.name);
	return { existed: true, kernelDeleted };
}

/**
 * Update the persisted `transcript_path` field on a named session, called
 * after `openSession` resolves where it will actually write the JSONL.
 */
export async function recordTranscriptPath(name: string, transcriptPath: string): Promise<void> {
	const meta = await readNamedSession(name);
	if (!meta) return;
	if (meta.transcript_path === transcriptPath) return;
	meta.transcript_path = transcriptPath;
	await writeNamedSession(meta);
}

export function shortKernelId(id: string): string {
	return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

export function formatRelativeAge(createdAt: number): string {
	const diff = Date.now() - createdAt;
	const sec = Math.max(0, Math.floor(diff / 1000));
	if (sec < 60) return `${sec}s`;
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m`;
	const hr = Math.floor(min / 60);
	if (hr < 24) return `${hr}h`;
	const d = Math.floor(hr / 24);
	return `${d}d`;
}
