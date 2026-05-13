import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { ComputerTranslator } from "@onkernel/cua-translator";
import { createGeminiBatchTool } from "../batch-tool";
import {
	createGeminiPerActionTools,
	type GeminiComputerToolsOptions as PerActionOptions,
} from "../computer-tool";

export interface GeminiComputerToolsOptions extends PerActionOptions {
	includeBatch?: boolean;
}

/**
 * Build the full Gemini computer-use tool set for `pi-agent-core`.
 */
export function createGeminiComputerTools(
	translator: ComputerTranslator,
	opts: GeminiComputerToolsOptions = {},
): AgentTool<any, any>[] {
	const tools = createGeminiPerActionTools(translator, opts);
	if (opts.includeBatch !== false) {
		tools.push(createGeminiBatchTool(translator));
	}
	return tools;
}

export { createGeminiPerActionTools } from "../computer-tool";
export type { GeminiToolDetails } from "../computer-tool";
export { createGeminiBatchTool } from "../batch-tool";
export type { GeminiBatchToolInput, GeminiBatchToolDetails } from "../batch";
