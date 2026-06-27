import type { AgentHarness, AgentTool, Session } from "@onkernel/cua-agent";
import type { ImageContent } from "@onkernel/cua-ai";
import {
	AuthStorage,
	discoverAndLoadExtensions,
	ExtensionRunner,
	ModelRegistry,
	SessionManager,
	wrapRegisteredTools,
} from "@earendil-works/pi-coding-agent";
import type {
	ExtensionActions,
	ExtensionCommandContextActions,
	ExtensionContextActions,
} from "@earendil-works/pi-coding-agent";
import { installBridge, type BridgeState } from "./bridge";
import {
	makeExtensionActions,
	makeExtensionCommandContextActions,
	makeExtensionContextActions,
} from "./seams";

export interface HarnessExtensionHostOptions {
	harness: AgentHarness;
	/** The same `Session` the harness was constructed with; used for entry writes. */
	session: Session;
	/** Capture a screenshot attachment for first-turn user messages. */
	initialScreenshot: () => Promise<ImageContent[] | undefined>;
	cwd: string;
	/** Extension paths passed straight to `discoverAndLoadExtensions`. */
	configuredPaths: string[];
	/** Agent config dir searched for `extensions/`. Pass a temp dir to isolate from `~/.agents`. */
	agentDir?: string;
}

/**
 * Host that plays pi `AgentSession`'s role against a `CuaAgentHarness`.
 *
 * It discovers and loads pi extensions through pi's host-agnostic loader and
 * runner, binds the runner's action seams to the harness, registers extension
 * tools, bridges harness events into the runner's extension-event emitters, and
 * mirrors `AgentSession.reload`. Everything runs headless: the runner falls back
 * to its internal no-op UI context, so `ctx.hasUI` is false and extensions that
 * guard on it short-circuit.
 *
 * Tier A only. Deferred (documented as follow-ups): `ctx.ui.*`, command/shortcut/
 * flag/renderer registration, the session-replacement family (stubbed to throw),
 * provider registration, and the message_end/input/user_bash/resources_discover
 * reducers.
 */
export class HarnessExtensionHost {
	private readonly harness: AgentHarness;
	private readonly session: Session;
	private readonly initialScreenshot: () => Promise<ImageContent[] | undefined>;
	private readonly cwd: string;
	private readonly configuredPaths: string[];
	private readonly agentDir?: string;
	private readonly sessionManager: SessionManager;
	private readonly modelRegistry: ModelRegistry;

	private readonly actions: ExtensionActions;
	private readonly contextActions: ExtensionContextActions;
	private readonly commandActions: ExtensionCommandContextActions;

	private runner: ExtensionRunner | undefined;
	private teardownBridge: (() => void) | undefined;
	private readonly bridgeState: BridgeState = { turnIndex: 0, isIdle: true };

	/** Tools produced by the runner this generation. Re-applied after model switches. */
	private extensionTools: AgentTool[] = [];
	/** Guards `harness.setTools` so a tools_update never re-enters reapply. */
	private applyingTools = false;
	/** Follow-up pass requested while `harness.setTools` is in flight. */
	private reapplyQueued = false;
	/** Marks reload critical sections where shutdown requests must not race. */
	private reloading = false;
	/** Sticky shutdown request raised by `ctx.shutdown()` or owner disposal. */
	private shutdownRequested = false;
	/** Guards `dispose` so `ctx.shutdown()` and an owner call don't double-tear-down. */
	private disposed = false;
	private sessionName: string | undefined;

	/** Load errors surfaced from the last discover; non-fatal. */
	loadErrors: Array<{ path: string; error: string }> = [];

	constructor(options: HarnessExtensionHostOptions) {
		this.harness = options.harness;
		this.session = options.session;
		this.initialScreenshot = options.initialScreenshot;
		this.cwd = options.cwd;
		this.configuredPaths = options.configuredPaths;
		this.agentDir = options.agentDir;
		this.sessionManager = SessionManager.inMemory(this.cwd);
		this.modelRegistry = ModelRegistry.inMemory(AuthStorage.inMemory());

		this.actions = makeExtensionActions(this.harness, this.session, {
			refreshTools: () => void this.reapplyTools(),
			sendUserMessage: (text) => this.promptUserMessage(text),
			getSessionName: () => this.sessionName,
			setSessionName: (name) => {
				this.sessionName = name;
			},
		});
		this.contextActions = makeExtensionContextActions(this.harness, {
			isIdle: () => this.bridgeState.isIdle,
			getSignal: () => undefined,
			shutdown: () => this.requestShutdown(),
		});
		this.commandActions = makeExtensionCommandContextActions(this.harness, () => this.reload());
	}

	async load(): Promise<void> {
		await this.buildRunner();
		await this.reapplyTools();
		this.installBridge();
		await this.runner?.emit({ type: "session_start", reason: "startup" });
	}

	/**
	 * Mirror `AgentSession.reload`: carry over flag values, tear down the old
	 * runner's bridge, re-discover extensions from disk, build a fresh runner over
	 * the same in-memory services, restore flags, rebind, re-apply tools, reinstall
	 * the bridge, then emit `session_start`. No extension cache is cleared because
	 * the loader imports each extension fresh from disk.
	 */
	async reload(): Promise<void> {
		if (this.disposed) return;
		const flags = this.runner?.getFlagValues() ?? new Map<string, boolean | string>();
		this.reloading = true;
		try {
			await this.runner?.emit({ type: "session_shutdown", reason: "reload" });
			if (await this.disposeIfShutdownRequested()) return;
			this.teardownBridge?.();
			this.teardownBridge = undefined;

			await this.buildRunner();
			if (await this.disposeIfShutdownRequested()) return;
			for (const [name, value] of flags) this.runner?.setFlagValue(name, value);

			await this.reapplyTools();
			if (await this.disposeIfShutdownRequested()) return;
			this.installBridge();
			await this.runner?.emit({ type: "session_start", reason: "reload" });
		} finally {
			this.reloading = false;
		}
	}

	/**
	 * Tear down the host: detach the bridge and notify extensions via
	 * `session_shutdown`. Idempotent — `ctx.shutdown()` routes here through
	 * `requestShutdown`, and the test/owner also calls it, so a guard keeps the
	 * two paths from running teardown twice. Note `runner.shutdown()` is pi's
	 * "request graceful shutdown" entrypoint (it invokes the bound shutdown
	 * handler), not a runner teardown, so it must not be called here.
	 */
	async dispose(): Promise<void> {
		if (this.disposed) return;
		this.shutdownRequested = true;
		this.disposed = true;
		this.teardownBridge?.();
		this.teardownBridge = undefined;
		await this.runner?.emit({ type: "session_shutdown", reason: "quit" });
		this.runner = undefined;
	}

	private async buildRunner(): Promise<void> {
		const result = await discoverAndLoadExtensions(this.configuredPaths, this.cwd, this.agentDir);
		this.loadErrors = result.errors;
		this.runner = new ExtensionRunner(
			result.extensions,
			result.runtime,
			this.cwd,
			this.sessionManager,
			this.modelRegistry,
		);
		this.runner.bindCore(this.actions, this.contextActions);
		this.runner.bindCommandContext(this.commandActions);
		this.runner.setUIContext(undefined, "print");
	}

	/**
	 * Rebuild the extension-tool union and apply it to the harness as the
	 * authoritative tool list. Existing active-tool choices are preserved for
	 * both base and extension tools, while newly introduced extension tools start
	 * active by default. A queued follow-up pass handles refresh requests that
	 * arrive while `harness.setTools` is still in flight.
	 */
	private async reapplyTools(): Promise<void> {
		if (!this.runner) return;
		if (this.applyingTools) {
			this.reapplyQueued = true;
			return;
		}
		do {
			this.reapplyQueued = false;
			if (!this.runner) return;

			const previousExtensionNames = new Set(this.extensionTools.map((tool) => tool.name));
			const nextExtensionTools = wrapRegisteredTools(this.runner.getAllRegisteredTools(), this.runner);
			const extensionNames = new Set(nextExtensionTools.map((tool) => tool.name));
			const base = this.harness.getTools().filter((tool) => !extensionNames.has(tool.name));
			const final = [...base, ...nextExtensionTools];
			const finalNames = new Set(final.map((tool) => tool.name));
			const activeNames = new Set(
				this.harness
					.getActiveTools()
					.map((tool) => tool.name)
					.filter((name) => finalNames.has(name)),
			);
			for (const name of extensionNames) {
				if (!previousExtensionNames.has(name)) activeNames.add(name);
			}

			this.extensionTools = nextExtensionTools;
			this.applyingTools = true;
			try {
				await this.harness.setTools(final, [...activeNames]);
			} finally {
				this.applyingTools = false;
			}
		} while (this.reapplyQueued);
	}

	private installBridge(): void {
		if (!this.runner) return;
		this.teardownBridge = installBridge(this.harness, this.runner, this.bridgeState, () =>
			this.reapplyTools(),
		);
	}

	private requestShutdown(): void {
		this.shutdownRequested = true;
		if (this.reloading) return;
		void this.dispose();
	}

	private async promptUserMessage(text: string): Promise<void> {
		const images = await this.maybeInitialScreenshot();
		await this.harness.prompt(text, images ? { images } : undefined);
	}

	private async maybeInitialScreenshot(): Promise<ImageContent[] | undefined> {
		const hasPriorTurn = await sessionHasPriorTurn(this.session);
		if (hasPriorTurn) return undefined;
		return this.initialScreenshot();
	}

	private async disposeIfShutdownRequested(): Promise<boolean> {
		if (!this.shutdownRequested && !this.disposed) return false;
		await this.dispose();
		return true;
	}
}

async function sessionHasPriorTurn(session: Session): Promise<boolean> {
	const entries = await session.getBranch();
	for (const entry of entries) {
		if (entry.type === "message" && (entry.message.role === "user" || entry.message.role === "assistant")) {
			return true;
		}
	}
	return false;
}
