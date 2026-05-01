export {
	CUA_ACTION_TYPES as ANTHROPIC_CUA_ACTION_TYPES,
	CUA_BATCH_TOOL_DESCRIPTION as ANTHROPIC_BATCH_DESCRIPTION,
	CUA_BATCH_TOOL_NAME as ANTHROPIC_BATCH_TOOL_NAME,
	createComputerToolDefinitions,
	createCuaActionSchema as createActionSchema,
	createCuaBatchSchema as createBatchSchema,
	CuaBatchSchema as AnthropicBatchSchema,
} from "../common.js";
export type {
	CuaAction as AnthropicAction,
	CreateComputerToolDefinitionsOptions,
	CuaBatchInput as AnthropicBatchInput,
} from "../common.js";

export const ANTHROPIC_COMPUTER_INSTRUCTIONS = `You control a Kernel cloud browser through computer-use tools. Use batched actions for predictable browser interaction, keyboard navigation where possible, and explicit screenshot or url reads when you need to inspect state.`;

export function buildAnthropicSystemPrompt(opts: { suffix?: string } = {}): string {
	return [ANTHROPIC_COMPUTER_INSTRUCTIONS, opts.suffix].filter(Boolean).join("\n\n");
}
