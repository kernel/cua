import {
	type Component,
	Container,
	Editor,
	hyperlink,
	KeybindingsManager,
	matchesKey,
	ProcessTerminal,
	Spacer,
	Text,
	TUI,
	TUI_KEYBINDINGS,
} from "@mariozechner/pi-tui";
import type { SessionManager } from "@mariozechner/pi-coding-agent";
import type { ResourceDiagnostic } from "@mariozechner/pi-coding-agent";
import type { BrowserSession } from "@onkernel/cua-translator";
import { homedir } from "node:os";
import { relative } from "node:path";
import { stderr } from "node:process";
import { createCuaAgent } from "../agent.js";
import type { Config } from "../config.js";
import { DEFAULT_MODEL_ID, resolveProvider } from "../models.js";
import {
	appendBrowserMetadata,
	persistAgentEvents,
	seedAgentFromSession,
} from "../sessions.js";
import { expandSkillInvocation, type Skill, type StartupResources } from "../skills.js";
import { openTuiDebugLog } from "./debug-log.js";
import { applyAndSummarizeImageProtocol } from "./diagnostics.js";
import { LiveInteractiveDriver, type InteractiveDriver } from "./driver.js";
import { type AssistantBuffer, MessageList } from "./message-list.js";
import { ScreenshotWidget } from "./screenshot-widget.js";
import { StatusLine } from "./status-line.js";
import { TelemetryFooter } from "./telemetry-footer.js";
import { colors, editorTheme } from "./themes.js";

export interface InteractiveOptions {
	cwd: string;
	browser: BrowserSession;
	config: Config;
	modelId?: string;
	initialPrompt?: string;
	verbose?: boolean;
	/** Image protocol override: kitty | iterm2 | none | auto (default: auto). */
	imageProtocol?: string;
	/** Optional session manager for transcript persistence. */
	sessionManager?: SessionManager;
	/** True when seeding the agent from a previously persisted session. */
	resumed?: boolean;
	/** Skills available for /skill:name expansion and system-prompt injection. */
	skills?: Skill[];
	/** Optional startup sections mirroring pi's Context/Skills inventory. */
	startupResources?: StartupResources;
	/** Enable extra TUI render diagnostics for manual repros. */
	debugTui?: boolean;
	/** Optional driver override used by deterministic PTY fixtures. */
	driver?: InteractiveDriver;
}

/**
 * Run the interactive cua TUI: pi-tui differential renderer with header /
 * message list / screenshot widget / editor / status line / footer hint.
 */
export async function runInteractive(opts: InteractiveOptions): Promise<number> {
	// Apply image protocol override BEFORE constructing TUI components so
	// the Image component sees the resolved capabilities on its first render.
	const { summary: capsSummary, overridden } = applyAndSummarizeImageProtocol(opts.imageProtocol);
	const debug = opts.debugTui ? openTuiDebugLog() : undefined;
	debug?.log("interactive_init", {
		model: opts.modelId ?? DEFAULT_MODEL_ID,
		browserSession: opts.browser.sessionId,
		liveUrl: opts.browser.liveUrl,
		capsSummary,
		imageProtocol: opts.imageProtocol ?? "auto",
		overridden,
	});

	const terminal = new ProcessTerminal();
	const tui = new TUI(terminal);
	const requestRender = (reason: string, force = false, data: Record<string, unknown> = {}): void => {
		debug?.log("request_render", {
			reason,
			force,
			columns: terminal.columns,
			rows: terminal.rows,
			fullRedraws: tui.fullRedraws,
			...data,
		});
		tui.requestRender(force);
	};

	const _keybindings = new KeybindingsManager(TUI_KEYBINDINGS);
	void _keybindings;
	const liveHandle = opts.driver
		? undefined
		: createCuaAgent({
				cwd: opts.cwd,
				browser: opts.browser,
				config: opts.config,
				modelId: opts.modelId,
				sessionId: opts.browser.sessionId,
				skills: opts.skills,
			});
	const editor = new Editor(tui, editorTheme);
	const messages = new MessageList();
	const screenshot = new ScreenshotWidget();
	const status = new StatusLine({
		model: opts.modelId ?? DEFAULT_MODEL_ID,
		browserSession: opts.browser.sessionId,
		liveUrl: opts.browser.liveUrl,
	});
	const footer = new TelemetryFooter({
		provider: liveHandle?.provider ?? (opts.driver ? "fixture" : resolveProvider(opts.modelId ?? DEFAULT_MODEL_ID)),
		model: liveHandle?.model.id ?? (opts.modelId ?? DEFAULT_MODEL_ID),
		thinkingLevel: liveHandle?.thinkingLevel,
		contextWindow: liveHandle?.model.contextWindow,
		autoCompactEnabled: isAutoCompactEnabled(liveHandle),
		contextTokens: 0,
	});

	const header = new Container();
	header.addChild(new Text(colors.bold("cua") + colors.dim(" — kernel-cloud-browser computer-use agent"), 0, 0));
	const capsHint = overridden
		? colors.dim(capsSummary)
		: colors.dim(capsSummary + " · set CUA_IMAGE_PROTOCOL=kitty|iterm2 to force inline images");
	header.addChild(new Text(capsHint, 0, 0));
	if (opts.browser.liveUrl) {
		header.addChild(new Text(colors.dim("live ") + hyperlink(opts.browser.liveUrl, opts.browser.liveUrl), 0, 0));
	}
	header.addChild(new Text("", 0, 0));
	const startupSections = buildStartupComponents(opts.startupResources, opts.cwd);

	tui.addChild(header);
	for (const section of startupSections) {
		tui.addChild(section);
	}
	tui.addChild(messages);
	tui.addChild(new Spacer(1));
	tui.addChild(screenshot);
	tui.addChild(new Spacer(1));
	tui.addChild(editor);
	tui.addChild(status);
	tui.addChild(footer);
	tui.setFocus(editor);
	tui.onDebug = () => {
		debug?.log("pi_tui_debug_key", {
			columns: terminal.columns,
			rows: terminal.rows,
			fullRedraws: tui.fullRedraws,
		});
	};

	let unsubscribePersist = () => {};
	const sm = opts.sessionManager;
	if (liveHandle && sm && opts.resumed) seedAgentFromSession(liveHandle.agent, sm);
	if (liveHandle && sm) appendBrowserMetadata(sm, opts.browser);
	if (liveHandle && sm && opts.resumed) {
		messages.addNotice(
			`resumed from ${sm.getSessionFile() ?? "memory"} · ${liveHandle.agent.state.messages.length} prior messages · fresh browser`,
		);
	}
	unsubscribePersist = liveHandle && sm ? persistAgentEvents(liveHandle.agent, sm) : () => {};
	let driver: InteractiveDriver =
		opts.driver ?? new LiveInteractiveDriver(liveHandle!, { skipInitialScreenshot: opts.resumed === true });

	let assistantBuffer: AssistantBuffer | undefined;
	let inflight = 0;

	const unsubscribe = driver.subscribe((event) => {
		if (event.type === "agent_start") {
			inflight += 1;
			status.update({ working: "thinking…" });
			debug?.log("agent_start", { inflight });
			requestRender("agent_start", false, { inflight });
			return;
		}
		if (event.type === "agent_end") {
			inflight -= 1;
			if (inflight <= 0) status.update({ working: undefined });
			debug?.log("agent_end", { inflight });
			requestRender("agent_end", false, { inflight });
			return;
		}
		if (event.type === "message_start" && event.message.role === "assistant") {
			assistantBuffer = messages.addAssistantStart();
			debug?.log("assistant_message_start");
			requestRender("assistant_message_start");
			return;
		}
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			assistantBuffer?.append(event.assistantMessageEvent.delta);
			requestRender("assistant_text_delta", false, {
				deltaLength: event.assistantMessageEvent.delta.length,
			});
			return;
		}
		if (event.type === "message_end" && event.message.role === "assistant") {
			const usage = "usage" in event.message ? event.message.usage : undefined;
			if (usage) {
				footer.update({
					contextTokens: usage.input,
				});
			}
			assistantBuffer?.end();
			assistantBuffer = undefined;
			debug?.log("assistant_message_end");
			requestRender("assistant_message_end");
			return;
		}
		if (event.type === "tool_execution_start") {
			messages.addToolCall(event.toolName, event.args);
			status.update({ working: event.toolName });
			debug?.log("tool_execution_start", { toolName: event.toolName });
			requestRender("tool_execution_start", false, { toolName: event.toolName });
			return;
		}
		if (event.type === "tool_execution_end") {
			const result = event.result as
				| {
						content?: Array<{ type?: string; data?: string; mimeType?: string }>;
						details?: { error?: string };
				  }
				| undefined;
			const isError = !!event.isError;
			let summary = isError ? colors.red("error") : colors.green("ok");
			if (!isError && result?.content) {
				const imgs = result.content.filter((c) => c?.type === "image");
				if (imgs.length > 0) summary += colors.dim(` · ${imgs.length} screenshot${imgs.length > 1 ? "s" : ""}`);
				const lastImg = imgs[imgs.length - 1];
				if (lastImg?.data) screenshot.update(lastImg.data, lastImg.mimeType ?? "image/png");
			}
			if (isError && result?.details?.error) summary = colors.red(result.details.error);
			messages.addToolResult(event.toolName, !isError, summary);
			debug?.log("tool_execution_end", {
				toolName: event.toolName,
				isError,
				hasImage: !!result?.content?.some((c) => c?.type === "image"),
			});
			requestRender("tool_execution_end", false, {
				toolName: event.toolName,
				isError,
			});
			return;
		}
	});

	const pendingPrompt = opts.initialPrompt?.trim() || "";
	let exitRequested = false;

	editor.onSubmit = (text: string) => {
		const trimmed = text.trim();
		if (!trimmed) return;
		editor.setText("");
		messages.addUser(trimmed);
		debug?.log("editor_submit", { length: trimmed.length });
		const { expanded, skill } = expandSkillInvocation(trimmed, opts.skills ?? []);
		if (skill) messages.addNotice(`expanding /skill:${skill.name}`);
		void runPrompt(expanded);
	};

	const removeListener = tui.addInputListener((data) => {
		if (matchesKey(data, "ctrl+c")) {
			if (driver.isStreaming()) {
				driver.abort();
				messages.addNotice("aborted");
				debug?.log("input_abort_stream", { key: "ctrl+c" });
				requestRender("input_abort_stream", false, { key: "ctrl+c" });
				return { consume: true };
			}
			exitRequested = true;
			debug?.log("input_exit_request", { key: "ctrl+c" });
			requestRender("input_exit_request", false, { key: "ctrl+c" });
			return { consume: true };
		}
		if (matchesKey(data, "ctrl+d")) {
			exitRequested = true;
			debug?.log("input_exit_request", { key: "ctrl+d" });
			return { consume: true };
		}
		if (matchesKey(data, "escape") && driver.isStreaming()) {
			driver.abort();
			messages.addNotice("turn aborted");
			debug?.log("input_abort_stream", { key: "escape" });
			requestRender("input_abort_stream", false, { key: "escape" });
			return { consume: true };
		}
		return undefined;
	});

	tui.start();
	debug?.log("tui_started", {
		columns: terminal.columns,
		rows: terminal.rows,
		fullRedraws: tui.fullRedraws,
	});

	const runPrompt = async (text: string): Promise<void> => {
		debug?.log("run_prompt_start", { length: text.length });
		try {
			await driver.submit(text);
		} catch (err) {
			messages.addError((err as Error).message);
			debug?.log("run_prompt_error", { message: (err as Error).message });
			requestRender("run_prompt_error", false, { message: (err as Error).message });
			return;
		}
		debug?.log("run_prompt_end");
	};

	try {
		if (pendingPrompt) {
			messages.addUser(pendingPrompt);
			const { expanded, skill } = expandSkillInvocation(pendingPrompt, opts.skills ?? []);
			if (skill) messages.addNotice(`expanding /skill:${skill.name}`);
			void runPrompt(expanded);
		}

		await waitForExit(
			() => exitRequested,
			() => driver.isStreaming(),
		);

		return 0;
	} finally {
		removeListener();
		unsubscribe();
		unsubscribePersist();
		tui.stop();
		try {
			await driver.dispose();
		} catch (err) {
			stderr.write(`[cua] cleanup warning: ${(err as Error).message}\n`);
		}
		debug?.close({
			fullRedraws: tui.fullRedraws,
			columns: terminal.columns,
			rows: terminal.rows,
		});
	}
}

async function waitForExit(shouldExit: () => boolean, isBusy: () => boolean): Promise<void> {
	while (true) {
		if (shouldExit() && !isBusy()) return;
		await new Promise<void>((resolve) => setTimeout(resolve, 100));
	}
}

function isAutoCompactEnabled(
	handle:
		| {
				modelConfig?: unknown;
		  }
		| undefined,
): boolean {
	const compactThreshold =
		handle?.modelConfig &&
		typeof handle.modelConfig === "object" &&
		"compactThreshold" in handle.modelConfig
			? (handle.modelConfig as { compactThreshold?: unknown }).compactThreshold
			: undefined;
	return typeof compactThreshold === "number" && compactThreshold > 0;
}

function buildStartupComponents(resources: StartupResources | undefined, cwd: string): Component[] {
	if (!resources) return [];

	const components: Component[] = [];
	const sections: Array<{ heading: string; color: (text: string) => string; body: string }> = [];

	if (resources.contextFiles.length > 0) {
		sections.push({
			heading: "Context",
			color: colors.blue,
			body: resources.contextFiles.map((file) => formatDisplayPath(file.path, cwd)).join(", "),
		});
	}

	if (resources.skills.length > 0) {
		sections.push({
			heading: "Skills",
			color: colors.blue,
			body: resources.skills.map((skill) => skill.name).join(", "),
		});
	}

	if (resources.skillDiagnostics.length > 0) {
		sections.push({
			heading: "Skill conflicts",
			color: colors.yellow,
			body: formatSkillDiagnostics(resources.skillDiagnostics, cwd),
		});
	}

	for (const section of sections) {
		components.push(new Text(section.color(`[${section.heading}]`) + `\n${section.body}`, 0, 0));
		components.push(new Spacer(1));
	}

	return components;
}

function formatSkillDiagnostics(diagnostics: ResourceDiagnostic[], cwd: string): string {
	const lines: string[] = [];
	const collisions = new Map<string, ResourceDiagnostic[]>();

	for (const diagnostic of diagnostics) {
		if (diagnostic.type === "collision" && diagnostic.collision) {
			const current = collisions.get(diagnostic.collision.name) ?? [];
			current.push(diagnostic);
			collisions.set(diagnostic.collision.name, current);
			continue;
		}

		if (diagnostic.path) {
			lines.push(`  ${formatDisplayPath(diagnostic.path, cwd)}`);
			lines.push(`    ${diagnostic.message}`);
		} else {
			lines.push(`  ${diagnostic.message}`);
		}
	}

	for (const [name, entries] of collisions) {
		const first = entries[0]?.collision;
		if (!first) continue;
		lines.push(`  "${name}" collision:`);
		lines.push(`    ${colors.green("✓")} ${formatDisplayPath(first.winnerPath, cwd)}`);
		for (const entry of entries) {
			if (!entry.collision) continue;
			lines.push(`    ${colors.yellow("✗")} ${formatDisplayPath(entry.collision.loserPath, cwd)} (skipped)`);
		}
	}

	return lines.join("\n");
}

function formatDisplayPath(filePath: string, cwd: string): string {
	const home = homedir();
	if (filePath === cwd) return ".";
	if (filePath.startsWith(`${cwd}/`)) {
		return relative(cwd, filePath) || ".";
	}
	if (filePath.startsWith(`${home}/`)) {
		return `~/${relative(home, filePath)}`;
	}
	return filePath;
}
