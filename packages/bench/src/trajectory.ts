import type { AgentHarnessEvent, CuaAgentHarness } from "@onkernel/cua-agent";
import type { TokenTotals } from "./types";

/** A trajectory step before it's assigned a screenshot filename. */
export interface RecordedStep {
	action: string;
	thought: string | null;
	screenshot: Buffer;
}

export interface TrajectoryRecording {
	steps: RecordedStep[];
	finalAnswer: string | null;
	tokens: TokenTotals;
	costUsd: number | null;
	turns: number;
}

/**
 * Subscribe to a running harness and accumulate the data WebJudge needs:
 * one step per computer action that produced a screenshot, the agent's final
 * answer, and summed token/cost usage. Returns the live recording plus an
 * unsubscribe handle.
 */
export function recordTrajectory(harness: CuaAgentHarness): {
	recording: TrajectoryRecording;
	stop: () => void;
} {
	const recording: TrajectoryRecording = {
		steps: [],
		finalAnswer: null,
		tokens: { input: 0, output: 0, total: 0 },
		costUsd: null,
		turns: 0,
	};
	const pendingActions = new Map<string, string>();
	let currentThought: string | null = null;

	const stop = harness.subscribe((event: AgentHarnessEvent) => {
		switch (event.type) {
			case "turn_start":
				recording.turns += 1;
				return;
			case "message_end": {
				if (event.message.role !== "assistant") return;
				const text = textOf(event.message.content);
				if (text) {
					currentThought = text;
					recording.finalAnswer = text;
				}
				const { usage } = event.message;
				recording.tokens.input += usage.input;
				recording.tokens.output += usage.output;
				recording.tokens.total += usage.totalTokens;
				if (usage.cost.total > 0) recording.costUsd = (recording.costUsd ?? 0) + usage.cost.total;
				return;
			}
			case "tool_execution_start":
				pendingActions.set(event.toolCallId, formatAction(event.toolName, event.args));
				return;
			case "tool_execution_end": {
				const action = pendingActions.get(event.toolCallId) ?? event.toolName;
				pendingActions.delete(event.toolCallId);
				const screenshot = screenshotOf(event.result);
				if (screenshot) recording.steps.push({ action, thought: currentThought, screenshot });
				return;
			}
			default:
				return;
		}
	});

	return { recording, stop };
}

function formatAction(toolName: string, args: unknown): string {
	const rendered = args && typeof args === "object" ? JSON.stringify(args) : String(args ?? "");
	return rendered ? `${toolName} ${rendered}` : toolName;
}

function screenshotOf(result: unknown): Buffer | undefined {
	const content = (result as { content?: Array<{ type?: string; data?: string }> } | undefined)?.content;
	if (!content) return undefined;
	for (const c of content) {
		if (c?.type === "image" && typeof c.data === "string") return Buffer.from(c.data, "base64");
	}
	return undefined;
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
