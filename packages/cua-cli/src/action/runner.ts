import type { Agent, AgentEvent } from "@mariozechner/pi-agent-core";
import type { SessionManager } from "@mariozechner/pi-coding-agent";
import { type BrowserSession, ComputerTranslator } from "@onkernel/cua-translator";
import { writeFile } from "node:fs/promises";
import { stderr, stdout } from "node:process";
import { promptWithScreenshot } from "../agent-prompt.js";
import { type CuaAgentHandle, createCuaAgent, type ProviderId } from "../agent.js";
import type { Config } from "../config.js";
import { persistAgentEvents, seedAgentFromSession } from "../sessions.js";
import { type ActionRequest, buildPrompt, DEFAULT_MAX_TURNS } from "./prompts.js";
import { type ActionEventInfo, type ActionResult, exitCodeFor, formatCompact, parseResult } from "./result.js";

export interface RunOptions {
	cwd: string;
	browser: BrowserSession;
	config: Config;
	modelId?: string;
	provider?: ProviderId;
	verbose?: boolean;
	maxTurns?: number;
	/**
	 * Optional SessionManager. When supplied, prior turns are seeded into
	 * the agent transcript and new messages are persisted as they emit.
	 * Used when chaining action subcommands via `-s <name>`.
	 */
	sessionManager?: SessionManager;
}

export interface ScreenshotOutput {
	out: string; // path or "-" for stdout
}

export interface RunActionResult {
	result: ActionResult;
	exitCode: number;
}

/**
 * Run a single action subcommand against an existing browser session and
 * return the parsed result + exit code.
 */
export async function runAction(
	req: ActionRequest,
	opts: RunOptions,
	screenshot?: ScreenshotOutput,
): Promise<RunActionResult> {
	const startedAt = Date.now();

	if (req.action === "screenshot") {
		const png = await screenshotPath(opts, screenshot ?? { out: "screenshot.png" });
		const elapsed = Date.now() - startedAt;
		const result = parseResult("screenshot", "", [], elapsed);
		result.text = png;
		return { result, exitCode: 0 };
	}

	const prompt = buildPrompt(req);
	const handle = createCuaAgent({
		cwd: opts.cwd,
		browser: opts.browser,
		config: opts.config,
		modelId: opts.modelId,
		provider: opts.provider,
		sessionId: opts.browser.sessionId,
	});

	let unsubscribePersist: (() => void) | undefined;
	let resumed = false;
	if (opts.sessionManager) {
		seedAgentFromSession(handle.agent, opts.sessionManager);
		unsubscribePersist = persistAgentEvents(handle.agent, opts.sessionManager);
		resumed = handle.agent.state.messages.some((m) => m.role === "user" || m.role === "assistant");
	}
	const initialMessageCount = handle.agent.state.messages.length;

	const events: ActionEventInfo[] = [];
	const maxTurns = req.maxTurns ?? opts.maxTurns ?? DEFAULT_MAX_TURNS;
	let turns = 0;
	let assistantText = "";
	const unsubscribe = handle.agent.subscribe((event: AgentEvent) => {
		if (event.type === "tool_execution_start") {
			collectEvent(event, events);
			return;
		}
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			assistantText += event.assistantMessageEvent.delta;
			return;
		}
		if (event.type === "turn_end") {
			turns += 1;
			if (turns >= maxTurns) {
				handle.agent.abort();
			}
		}
	});

	let runError: Error | undefined;
	try {
		await promptWithScreenshot({
			agent: handle.agent,
			translator: handle.translator,
			prompt,
			options: { skipInitialScreenshot: resumed },
		});
	} catch (err) {
		runError = err instanceof Error ? err : new Error(String(err));
	} finally {
		unsubscribe();
		unsubscribePersist?.();
	}

	const elapsed = Date.now() - startedAt;

	if (assistantText.trim() === "") {
		const messages = handle.agent.state.messages;
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (msg && msg.role === "assistant") {
				for (const block of msg.content) {
					if (block.type === "text") assistantText += block.text;
				}
				break;
			}
		}
	}

	if (runError) {
		const result: ActionResult = {
			action: req.action,
			status: "error",
			text: runError.message,
			elapsedMs: elapsed,
			timestamp: Date.now(),
		};
		return { result, exitCode: exitCodeFor(result) };
	}

	const toolError = extractLatestToolError(handle.agent.state.messages.slice(initialMessageCount));
	const result = parseResult(req.action, assistantText, events, elapsed, toolError);
	return { result, exitCode: exitCodeFor(result) };
}

interface ToolResultLike {
	role: "toolResult";
	isError?: boolean;
	content?: Array<{ type?: string; text?: string }>;
	details?: { error?: unknown };
}

function isToolErrorMessage(message: unknown): message is ToolResultLike {
	if (!message || typeof message !== "object") return false;
	const candidate = message as { role?: unknown; isError?: unknown };
	return candidate.role === "toolResult" && candidate.isError === true;
}

function extractLatestToolError(messages: readonly unknown[]): string | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (!isToolErrorMessage(msg)) continue;
		const detailError = typeof msg.details?.error === "string" ? msg.details.error.trim() : "";
		if (detailError) return detailError;
		const textParts = Array.isArray(msg.content)
			? msg.content
					.filter(
						(block): block is { type: "text"; text: string } =>
							block.type === "text" && typeof block.text === "string",
					)
					.map((block) => block.text.trim())
					.filter((text) => text.length > 0)
			: [];
		if (textParts.length > 0) return textParts.join("\n");
		return "tool execution failed";
	}
	return undefined;
}

function collectEvent(
	event: { type: "tool_execution_start"; toolName: string; args: any },
	events: ActionEventInfo[],
): void {
	switch (event.toolName) {
		case "batch_computer_actions":
		case "computer_use_extra": {
			const args = event.args as { actions?: Array<{ type?: string; x?: number; y?: number }>; action?: string; url?: string; x?: number; y?: number } | undefined;
			const actions = args?.actions ?? [];
			for (const a of actions) {
				const t = typeof a.type === "string" ? a.type : "";
				if (t === "click" || t === "double_click") {
					events.push({
						actionType: t,
						x: typeof a.x === "number" ? a.x : undefined,
						y: typeof a.y === "number" ? a.y : undefined,
					});
				}
			}
			return;
		}
		case "computer": {
			// Anthropic single-action shape
			const args = event.args as { action?: string; coordinate?: [number, number] } | undefined;
			const a = args?.action ?? "";
			const coord = args?.coordinate;
			const isClick =
				a === "left_click" ||
				a === "right_click" ||
				a === "middle_click" ||
				a === "double_click" ||
				a === "triple_click";
			if (isClick && Array.isArray(coord) && coord.length >= 2) {
				events.push({ actionType: a, x: Number(coord[0]), y: Number(coord[1]) });
			}
			return;
		}
		case "click_at": {
			// Gemini per-action tool with normalized 0-1000 coords
			const args = event.args as { x?: number; y?: number } | undefined;
			if (typeof args?.x === "number" && typeof args?.y === "number") {
				events.push({ actionType: "click_at", x: args.x, y: args.y });
			}
			return;
		}
		default:
			return;
	}
}

async function screenshotPath(opts: RunOptions, out: ScreenshotOutput): Promise<string> {
	const translator = new ComputerTranslator({
		client: opts.browser.client,
		sessionId: opts.browser.sessionId,
	});
	const png = await translator.screenshotRaw();
	if (out.out === "-") {
		stdout.write(png);
		return "(stdout)";
	}
	await writeFile(out.out, png);
	return out.out;
}

/** Print a compact result line and return its exit code. */
export function emitCompact(res: RunActionResult): number {
	const text = formatCompact(res.result);
	if (text) stdout.write(`${text}\n`);
	if (res.exitCode !== 0 && !text.startsWith("error") && res.result.status === "error") {
		stderr.write(`error ${res.result.text ?? ""}\n`);
	}
	return res.exitCode;
}

export function disposeHandle(handle: CuaAgentHandle): Promise<void> {
	return handle.dispose();
}
