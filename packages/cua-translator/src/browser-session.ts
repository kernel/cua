import Kernel, { NotFoundError } from "@onkernel/sdk";

export interface BrowserSessionOptions {
	apiKey: string;
	baseUrl?: string;
	timeoutSeconds?: number;
	/** Profile id or name. If a name is supplied that doesn't exist, it is created. */
	profileSelector?: string;
	/** Explicit profile id (skips lookup). */
	profileId?: string;
	/** Whether to save changes back to the profile when the session ends. */
	saveChanges?: boolean;
}

export interface BrowserSession {
	readonly client: Kernel;
	readonly sessionId: string;
	readonly liveUrl?: string;
	readonly profileId?: string;
	close(): Promise<void>;
}

const CUID2_LENGTH = 24;
const CUID2_PATTERN = /^[a-z][a-z0-9]{23}$/;

function looksLikeProfileId(selector: string): boolean {
	const trimmed = selector.trim();
	return trimmed.length === CUID2_LENGTH && CUID2_PATTERN.test(trimmed);
}

async function resolveProfileId(client: Kernel, selector: string): Promise<string> {
	const trimmed = selector.trim();
	if (!trimmed) throw new Error("profile selector is empty");

	try {
		const existing = await client.profiles.retrieve(trimmed);
		return existing.id;
	} catch (err) {
		if (!(err instanceof NotFoundError)) {
			throw new Error(`looking up browser profile "${trimmed}": ${(err as Error).message}`, { cause: err });
		}
		if (looksLikeProfileId(trimmed)) {
			throw new Error(`browser profile "${trimmed}" was not found`);
		}
		const created = await client.profiles.create({ name: trimmed });
		return created.id;
	}
}

/** Provision a fresh Kernel cloud browser session and return a handle. */
export async function open(opts: BrowserSessionOptions): Promise<BrowserSession> {
	const client = new Kernel({
		apiKey: opts.apiKey,
		...(opts.baseUrl ? { baseURL: opts.baseUrl } : {}),
	});

	const timeoutSeconds = opts.timeoutSeconds && opts.timeoutSeconds > 0 ? opts.timeoutSeconds : 300;

	let profileId = (opts.profileId ?? "").trim();
	if (!profileId && opts.profileSelector && opts.profileSelector.trim()) {
		profileId = await resolveProfileId(client, opts.profileSelector);
	}

	const params: Parameters<typeof client.browsers.create>[0] = {
		stealth: true,
		timeout_seconds: timeoutSeconds,
	};
	if (profileId) {
		params.profile = {
			id: profileId,
			save_changes: opts.saveChanges ?? false,
		};
	}

	const browser = await client.browsers.create(params);

	return {
		client,
		sessionId: browser.session_id,
		liveUrl: browser.browser_live_view_url,
		profileId: profileId || undefined,
		async close(): Promise<void> {
			await client.browsers.deleteByID(browser.session_id);
		},
	};
}

export interface AttachBrowserSessionOptions {
	apiKey: string;
	baseUrl?: string;
	/** Existing Kernel browser session id to attach to. */
	sessionId: string;
	/** Optional cached live-view URL from when the session was first created. */
	liveUrl?: string;
	/** Optional profile id the session was started with. */
	profileId?: string;
}

/**
 * Attach to an existing Kernel cloud browser session by id, without
 * calling `client.browsers.create`. The returned handle's `close()` is a
 * NO-OP — use `client.browsers.deleteByID(sessionId)` directly when you
 * actually want to tear the session down.
 *
 * Liveness is the caller's responsibility: a freshly-attached handle may
 * still talk to a session that has timed out server-side. Run
 * `client.browsers.retrieve(sessionId)` first to check.
 */
export function attach(opts: AttachBrowserSessionOptions): BrowserSession {
	const client = new Kernel({
		apiKey: opts.apiKey,
		...(opts.baseUrl ? { baseURL: opts.baseUrl } : {}),
	});
	return {
		client,
		sessionId: opts.sessionId,
		liveUrl: opts.liveUrl,
		profileId: opts.profileId,
		async close(): Promise<void> {
			// no-op: attached sessions are not torn down on handle close.
		},
	};
}
