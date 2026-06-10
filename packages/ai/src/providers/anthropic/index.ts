import type { ComputerToolCoordinateSystem, CuaProviderModule } from "../common.js";
import { computerToolExecutors, computerTools } from "./actions.js";

export {
	ANTHROPIC_BATCH_TOOL_NAME,
	ANTHROPIC_CUA_ACTION_TYPES,
	computerToolExecutors,
	computerTools,
	createActionSchema,
} from "./actions.js";
export type {
	AnthropicAction,
	AnthropicComputerToolsOptions,
	AnthropicComputerToolsOptions as ComputerToolsOptions,
} from "./actions.js";

// Anthropic's quickstart uses pixel coordinates for both its computer and
// browser tools.
// Source: https://github.com/anthropics/claude-quickstarts/tree/main/computer-use-best-practices
export function coordinateSystem(): ComputerToolCoordinateSystem {
	return { type: "pixel" };
}

export const ANTHROPIC_COMPUTER_INSTRUCTIONS = `You control a Kernel cloud browser through individual browser tools. Use keyboard navigation where possible, and request screenshots when you need to inspect state.`;

export function buildAnthropicSystemPrompt(opts: { suffix?: string } = {}): string {
	return [ANTHROPIC_COMPUTER_INSTRUCTIONS, opts.suffix].filter(Boolean).join("\n\n");
}

export const providerModule = {
	toolDefinitions: computerTools,
	toolExecutors: computerToolExecutors,
	coordinateSystem,
	buildSystemPrompt: buildAnthropicSystemPrompt,
} satisfies CuaProviderModule;
