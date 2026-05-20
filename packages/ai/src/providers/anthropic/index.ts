import type { ComputerToolCoordinateSystem } from "../common";

export {
	computerToolExecutors,
	computerTools,
	createActionSchema,
} from "./actions";
export type {
	AnthropicAction,
	AnthropicComputerToolsOptions,
	AnthropicComputerToolsOptions as ComputerToolsOptions,
} from "./actions";

// Anthropic's quickstart uses pixel coordinates for both its computer and
// browser tools.
// Source: https://github.com/anthropics/claude-quickstarts/tree/main/computer-use-best-practices
export const COMPUTER_TOOL_COORDINATES = { type: "pixel" } as const satisfies ComputerToolCoordinateSystem;

export const ANTHROPIC_COMPUTER_INSTRUCTIONS = `You control a Kernel cloud browser through individual browser tools. Use keyboard navigation where possible, and request screenshots when you need to inspect state.`;

export function buildAnthropicSystemPrompt(opts: { suffix?: string } = {}): string {
	return [ANTHROPIC_COMPUTER_INSTRUCTIONS, opts.suffix].filter(Boolean).join("\n\n");
}
