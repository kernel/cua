import { CuaAgentHarness, JsonlSessionRepo, NodeExecutionEnv } from "@onkernel/cua-agent";
import { type CuaModelRef, getCuaEnvApiKey, type ImageContent, resolveCuaRuntimeSpec } from "@onkernel/cua-ai";
import type Kernel from "@onkernel/sdk";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BrowserSettings, captureScreenshot, provisionBrowser } from "./browser";
import { recordTrajectory, type TrajectoryRecording } from "./trajectory";
import type { ActionStep, Om2wResult, Om2wTask, TaskMetrics } from "./types";

/** Filesystem-safe slug for a provider-qualified model ref like `anthropic:claude-opus-4-6`. */
export function modelSlug(model: CuaModelRef): string {
	return model.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function buildPrompt(task: Om2wTask): string {
	if (task.website && !task.confirmed_task.toLowerCase().includes(task.website.toLowerCase())) {
		return `Go to ${task.website} and ${task.confirmed_task}`;
	}
	return task.confirmed_task;
}

/**
 * Run one Online-Mind2Web task on one model against a fresh Kernel browser and
 * write the official v2 trajectory (`result.json` + `trajectory/`) plus a
 * `metrics.json` cost/speed sidecar into `taskDir`.
 */
export async function runOne(
	client: Kernel,
	model: CuaModelRef,
	task: Om2wTask,
	settings: BrowserSettings,
	taskDir: string,
): Promise<TaskMetrics> {
	const handle = await provisionBrowser(client, settings);
	const cwd = process.cwd();
	const repo = new JsonlSessionRepo({
		fs: new NodeExecutionEnv({ cwd }),
		sessionsRoot: join(tmpdir(), "cua-bench", "sessions"),
	});
	const session = await repo.create({ cwd });

	const harness = new CuaAgentHarness({
		env: new NodeExecutionEnv({ cwd }),
		session,
		model,
		browser: handle.browser,
		client,
		systemPrompt: ({ model: active }) => resolveCuaRuntimeSpec(active).defaultSystemPrompt,
		getApiKeyAndHeaders: async (resolved) => {
			const apiKey = getCuaEnvApiKey(resolved.provider);
			return apiKey ? { apiKey } : undefined;
		},
	});

	const { recording, stop } = recordTrajectory(harness);
	const startedAt = Date.now();
	let stopReason = "completed";
	let errorMessage: string | undefined;
	try {
		const shot = await captureScreenshot(handle.client, handle.browser.session_id);
		const images: ImageContent[] | undefined = shot
			? [{ type: "image", data: shot.toString("base64"), mimeType: "image/png" }]
			: undefined;
		const assistant = await harness.prompt(buildPrompt(task), images ? { images } : undefined);
		stopReason = assistant.stopReason;
		if (assistant.stopReason === "error" || assistant.stopReason === "aborted") {
			errorMessage = assistant.errorMessage ?? `agent stopped with ${assistant.stopReason}`;
		}
	} finally {
		stop();
		await handle.close();
	}

	const wallClockMs = Date.now() - startedAt;
	const metrics: TaskMetrics = {
		task_id: task.task_id,
		model,
		wallClockMs,
		steps: recording.turns,
		tokens: recording.tokens,
		costUsd: recording.costUsd,
		stopReason,
		errorMessage,
	};
	await writeArtifacts(taskDir, task, recording, metrics);
	return metrics;
}

async function writeArtifacts(
	taskDir: string,
	task: Om2wTask,
	recording: TrajectoryRecording,
	metrics: TaskMetrics,
): Promise<void> {
	const trajectoryDir = join(taskDir, "trajectory");
	await mkdir(trajectoryDir, { recursive: true });

	const action_history: ActionStep[] = [];
	for (let i = 0; i < recording.steps.length; i++) {
		const step = recording.steps[i]!;
		const screenshot = `${String(i).padStart(4, "0")}.png`;
		await writeFile(join(trajectoryDir, screenshot), step.screenshot);
		action_history.push({ step: i, screenshot, action: step.action, thought: step.thought, url: null });
	}

	const result: Om2wResult = {
		schema_version: "online-mind2web-v2",
		task: task.confirmed_task,
		task_id: task.task_id,
		agent_final_answer: recording.finalAnswer,
		reference_length: task.reference_length,
		action_history,
	};
	await writeFile(join(taskDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
	await writeFile(join(taskDir, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
}
