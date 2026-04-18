import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { ComputerTranslator } from "@onkernel/cua-translator";
import { createAnthropicBatchTool } from "../batch-tool.js";
import { createAnthropicComputerTool } from "../computer-tool.js";

export interface AnthropicComputerToolsOptions {
	/** Set false to omit the built-in `computer` tool. Defaults to true. */
	includeComputer?: boolean;
	/** Set false to omit the cua-added `batch_computer_actions` tool. Defaults to true. */
	includeBatch?: boolean;
}

/**
 * Build the Anthropic computer-use tool set for `pi-agent-core`.
 * Pair with root prompt/system helpers and the Anthropic-specific stream hooks.
 */
export function createAnthropicComputerTools(
	translator: ComputerTranslator,
	opts: AnthropicComputerToolsOptions = {},
): AgentTool<any, any>[] {
	const tools: AgentTool<any, any>[] = [];
	if (opts.includeComputer !== false) tools.push(createAnthropicComputerTool(translator));
	if (opts.includeBatch !== false) tools.push(createAnthropicBatchTool(translator));
	return tools;
}

export { createAnthropicComputerTool } from "../computer-tool.js";
export type { AnthropicComputerDetails, AnthropicComputerInput } from "../computer.js";
export { createAnthropicBatchTool } from "../batch-tool.js";
export type { AnthropicBatchToolDetails, AnthropicBatchToolInput } from "../batch.js";
export {
	registerAnthropicProvider,
	wrapAnthropicStream,
} from "../stream-wrapper.js";
export {
	anthropicComputerOnPayload,
	composeOnPayload,
} from "../payload-hook.js";
