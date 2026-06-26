import { type AgentHarnessEvent, CuaAgentHarness, JsonlSessionRepo, NodeExecutionEnv } from "@onkernel/cua-agent";
import { type CuaModelRef, getCuaEnvApiKey, type ImageContent, resolveCuaRuntimeSpec } from "@onkernel/cua-ai";
import Kernel from "@onkernel/sdk";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Task, TaskResult, TokenTotals } from "./types";

export interface RunTaskOptions {
	/** Kernel API key. Defaults to `KERNEL_API_KEY`. */
	kernelApiKey?: string;
	/** Kernel browser session lifetime in seconds. Defaults to 300. */
	timeoutSeconds?: number;
	/** Root directory for jsonl transcripts. Defaults to a temp dir. */
	sessionsRoot?: string;
}

/**
 * Run a single benchmark task on a single model against a fresh Kernel
 * browser. Returns timing and token totals; `success` and `costUsd` are
 * not scored here.
 */
export async function runTask(
	modelRef: CuaModelRef,
	task: Task,
	options: RunTaskOptions = {},
): Promise<TaskResult> {
	const kernelApiKey = options.kernelApiKey ?? process.env.KERNEL_API_KEY;
	if (!kernelApiKey) throw new Error("KERNEL_API_KEY is required to run a benchmark task");

	const client = new Kernel({ apiKey: kernelApiKey });
	const browser = await client.browsers.create({
		stealth: true,
		timeout_seconds: options.timeoutSeconds && options.timeoutSeconds > 0 ? options.timeoutSeconds : 300,
	});

	const cwd = process.cwd();
	const repo = new JsonlSessionRepo({
		fs: new NodeExecutionEnv({ cwd }),
		sessionsRoot: options.sessionsRoot ?? join(tmpdir(), "cua-bench", "sessions"),
	});
	const session = await repo.create({ cwd });

	const tokens: TokenTotals = { input: 0, output: 0, total: 0 };
	let costUsd: number | null = null;
	let steps = 0;

	const harness = new CuaAgentHarness({
		env: new NodeExecutionEnv({ cwd }),
		session,
		model: modelRef,
		browser,
		client,
		systemPrompt: ({ model }) => resolveCuaRuntimeSpec(model).defaultSystemPrompt,
		getApiKeyAndHeaders: async (resolved) => {
			const apiKey = getCuaEnvApiKey(resolved.provider);
			return apiKey ? { apiKey } : undefined;
		},
	});

	const unsubscribe = harness.subscribe((event: AgentHarnessEvent) => {
		if (event.type === "turn_start") {
			steps += 1;
			return;
		}
		if (event.type === "message_end" && event.message.role === "assistant") {
			const { usage } = event.message;
			tokens.input += usage.input;
			tokens.output += usage.output;
			tokens.total += usage.totalTokens;
			if (usage.cost.total > 0) costUsd = (costUsd ?? 0) + usage.cost.total;
		}
	});

	const startedAt = Date.now();
	let stopReason = "completed";
	let finalText = "";
	let errorMessage: string | undefined;
	try {
		const screenshot = await captureScreenshot(client, browser.session_id);
		const images: ImageContent[] | undefined = screenshot
			? [{ type: "image", data: screenshot, mimeType: "image/png" }]
			: undefined;
		const assistant = await harness.prompt(task.prompt, images ? { images } : undefined);
		stopReason = assistant.stopReason;
		finalText = textOf(assistant.content);
		if (assistant.stopReason === "error" || assistant.stopReason === "aborted") {
			errorMessage = assistant.errorMessage ?? `agent stopped with ${assistant.stopReason}`;
		}
	} finally {
		unsubscribe();
		await client.browsers.deleteByID(browser.session_id).catch(() => {});
	}

	return {
		model: modelRef,
		taskId: task.id,
		success: null,
		stopReason,
		finalText,
		errorMessage,
		wallClockMs: Date.now() - startedAt,
		steps,
		tokens,
		costUsd,
	};
}

async function captureScreenshot(client: Kernel, sessionId: string): Promise<string | undefined> {
	try {
		const response = await client.browsers.computer.captureScreenshot(sessionId);
		const arrayBuffer = await response.arrayBuffer();
		return Buffer.from(arrayBuffer).toString("base64");
	} catch {
		return undefined;
	}
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const c of content) {
		if (c && typeof c === "object" && (c as { type?: unknown }).type === "text" && typeof (c as { text?: unknown }).text === "string") {
			parts.push((c as { text: string }).text);
		}
	}
	return parts.join("\n");
}
