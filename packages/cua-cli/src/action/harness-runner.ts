import type { AgentHarnessEvent, CuaAgentHarness, Session } from "@onkernel/cua-agent";
import { writeFile } from "node:fs/promises";
import { stderr, stdout } from "node:process";
import { captureScreenshot, type CuaBrowserHandle } from "../harness-browser";
import { type ActionRequest, buildPrompt, DEFAULT_MAX_TURNS } from "./prompts";
import { type ActionEventInfo, type ActionResult, exitCodeFor, formatCompact, parseResult } from "./result";

export interface HarnessRunOptions {
	harness: CuaAgentHarness;
	browserHandle: CuaBrowserHandle;
	session: Session;
	verbose?: boolean;
	maxTurns?: number;
}

export interface ScreenshotOutput {
	out: string; // path or "-" for stdout
}

export interface RunActionResult {
	result: ActionResult;
	exitCode: number;
}

/**
 * Run a single action subcommand against an existing harness + browser and
 * return the parsed result plus exit code. The `screenshot` action is
 * model-free — it captures directly through the SDK. All other actions
 * drive the harness for at most `maxTurns` turns.
 */
export async function runAction(
	req: ActionRequest,
	opts: HarnessRunOptions,
	screenshot?: ScreenshotOutput,
): Promise<RunActionResult> {
	const startedAt = Date.now();

	if (req.action === "screenshot") {
		const out = screenshot ?? { out: "screenshot.png" };
		const png = await captureScreenshot(opts.browserHandle.client, opts.browserHandle.browser.session_id);
		if (!png) {
			const elapsed = Date.now() - startedAt;
			const result: ActionResult = {
				action: "screenshot",
				status: "error",
				text: "failed to capture screenshot",
				elapsedMs: elapsed,
				timestamp: Date.now(),
			};
			return { result, exitCode: exitCodeFor(result) };
		}
		if (out.out === "-") {
			stdout.write(png);
		} else {
			await writeFile(out.out, png);
		}
		const elapsed = Date.now() - startedAt;
		const result = parseResult("screenshot", "", [], elapsed);
		result.text = out.out === "-" ? "(stdout)" : out.out;
		return { result, exitCode: 0 };
	}

	const prompt = buildPrompt(req);
	const maxTurns = req.maxTurns ?? opts.maxTurns ?? DEFAULT_MAX_TURNS;

	const events: ActionEventInfo[] = [];
	let assistantText = "";
	let turns = 0;
	let aborted = false;
	let lastToolError: string | undefined;

	const unsubscribe = opts.harness.subscribe((event: AgentHarnessEvent) => {
		switch (event.type) {
			case "tool_execution_start":
				collectActionEvent(event.toolName, event.args, events);
				return;
			case "tool_execution_end": {
				if (event.isError) {
					lastToolError = extractToolErrorText(event.result) ?? "tool execution failed";
				}
				return;
			}
			case "message_update":
				if (event.assistantMessageEvent.type === "text_delta") {
					assistantText += event.assistantMessageEvent.delta;
				}
				return;
			case "turn_end":
				turns += 1;
				if (turns >= maxTurns && !aborted) {
					aborted = true;
					void opts.harness.abort();
				}
				return;
			default:
				return;
		}
	});

	let runError: Error | undefined;
	try {
		const assistant = await opts.harness.prompt(prompt);
		if (assistant.stopReason === "error") {
			runError = new Error(assistant.errorMessage ?? "agent stopped with error");
		}
	} catch (err) {
		runError = err instanceof Error ? err : new Error(String(err));
	} finally {
		unsubscribe();
	}

	const elapsed = Date.now() - startedAt;

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

	const result = parseResult(req.action, assistantText, events, elapsed, lastToolError);
	return { result, exitCode: exitCodeFor(result) };
}

/**
 * Collect click coordinates from canonical CUA tool calls. The harness
 * dispatches batched calls via `computer_batch` (args: { actions: [...] })
 * and single-action calls via per-action tools (args: cua action without
 * the `type` field, which we recover from the tool name).
 */
function collectActionEvent(toolName: string, args: unknown, events: ActionEventInfo[]): void {
	if (toolName === "computer_batch") {
		const actions = (args as { actions?: unknown }).actions;
		if (Array.isArray(actions)) {
			for (const action of actions) {
				if (action && typeof action === "object") {
					addClickEvent(
						(action as { type?: unknown }).type,
						(action as { x?: unknown }).x,
						(action as { y?: unknown }).y,
						events,
					);
				}
			}
		}
		return;
	}
	if (args && typeof args === "object") {
		const x = (args as { x?: unknown }).x;
		const y = (args as { y?: unknown }).y;
		addClickEvent(toolName, x, y, events);
	}
}

function addClickEvent(type: unknown, x: unknown, y: unknown, events: ActionEventInfo[]): void {
	if (typeof type !== "string") return;
	if (type !== "click" && type !== "double_click") return;
	if (typeof x !== "number" || typeof y !== "number") return;
	events.push({ actionType: type, x, y });
}

function extractToolErrorText(result: unknown): string | undefined {
	if (!result || typeof result !== "object") return undefined;
	const content = (result as { content?: unknown }).content;
	if (!Array.isArray(content)) return undefined;
	const parts: string[] = [];
	for (const block of content) {
		if (block && typeof block === "object" && (block as { type?: unknown }).type === "text") {
			const text = (block as { text?: unknown }).text;
			if (typeof text === "string" && text.trim().length > 0) parts.push(text.trim());
		}
	}
	return parts.length > 0 ? parts.join("\n") : undefined;
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
