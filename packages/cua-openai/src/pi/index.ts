import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { ComputerTranslator } from "@onkernel/cua-translator";
import { createBatchTool } from "../batch-tool";
import { createExtraTool } from "../extra-tool";

export interface OpenAIComputerToolsOptions {
	/** Set false to omit `batch_computer_actions`. Defaults to true. */
	includeBatch?: boolean;
	/** Set false to omit `computer_use_extra`. Defaults to true. */
	includeExtra?: boolean;
}

/**
 * Build the OpenAI computer-use tool set for `pi-agent-core`.
 * Pair with `OPENAI_BATCH_INSTRUCTIONS` from the root package.
 */
export function createOpenAIComputerTools(
	translator: ComputerTranslator,
	opts: OpenAIComputerToolsOptions = {},
): AgentTool<any, any>[] {
	const tools: AgentTool<any, any>[] = [];
	if (opts.includeBatch !== false) tools.push(createBatchTool(translator));
	if (opts.includeExtra !== false) tools.push(createExtraTool(translator));
	return tools;
}

export { createBatchTool } from "../batch-tool";
export type { BatchToolDetails, BatchToolInput } from "../batch";
export { createExtraTool } from "../extra-tool";
export type { ExtraToolDetails, ExtraToolInput } from "../extra";
