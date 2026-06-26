import type { AgentHarnessEvent, AgentMessage } from "@onkernel/cua-agent";
import type { Trajectory, TrajectoryStep } from "./types";

interface ToolResultLike {
	content?: Array<{ type: string; data?: string; mimeType?: string }>;
}

/**
 * Builds a {@link Trajectory} from harness events. Each non-error
 * `tool_execution_end` becomes one step, capturing the last image in the tool
 * result as that step's screenshot and the args recorded at the matching
 * `tool_execution_start`.
 */
export function createTrajectoryCollector(): {
	handler: (event: AgentHarnessEvent) => void;
	build: (finalAnswer: string) => Trajectory;
} {
	const steps: TrajectoryStep[] = [];
	const argsByCallId = new Map<string, unknown>();
	const handler = (event: AgentHarnessEvent): void => {
		if (event.type === "tool_execution_start") {
			argsByCallId.set(event.toolCallId, event.args);
			return;
		}
		if (event.type !== "tool_execution_end" || event.isError) return;
		const content = (event.result as ToolResultLike | undefined)?.content ?? [];
		const lastImage = [...content].reverse().find((c) => c.type === "image");
		steps.push({
			index: steps.length,
			action: `${event.toolName} ${compactArgs(argsByCallId.get(event.toolCallId))}`.trim(),
			screenshotBase64: lastImage?.data,
			screenshotMimeType: lastImage?.mimeType,
		});
	};
	return { handler, build: (finalAnswer) => ({ steps, finalAnswer }) };
}

interface BranchEntryLike {
	type: string;
	message?: AgentMessage;
}

/** Last assistant text from a session branch, joining its text blocks. */
export function extractFinalAnswer(branch: BranchEntryLike[]): string {
	const last = [...branch]
		.reverse()
		.flatMap((entry) =>
			entry.type === "message" && entry.message?.role === "assistant" ? [entry.message] : [],
		)[0];
	const content = last?.content ?? [];
	return content
		.flatMap((block) => (block.type === "text" ? [block.text] : []))
		.join("")
		.trim();
}

function compactArgs(args: unknown): string {
	const s = safeStringify(args);
	return s.length > 200 ? `${s.slice(0, 197)}...` : s;
}

function safeStringify(args: unknown): string {
	try {
		return JSON.stringify(args) ?? "";
	} catch {
		return "";
	}
}
