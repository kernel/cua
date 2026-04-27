import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ImageContent, TextContent } from "@mariozechner/pi-ai";
import type { ComputerTranslator } from "@onkernel/cua-translator";
import {
	BatchSchema,
	type BatchToolDetails,
	executeOpenAIBatch,
	OPENAI_BATCH_DESCRIPTION,
	OPENAI_BATCH_TOOL_NAME,
} from "./batch.js";

/**
 * Build the `batch_computer_actions` AgentTool for OpenAI computer-use models.
 *
 * The tool's parameter schema is the union of OpenAI's official action set
 * ({@link OPENAI_OFFICIAL_ACTION_TYPES}) and the cua extension actions
 * ({@link OPENAI_CUA_EXTRA_ACTION_TYPES}). The tool's `execute` hands the
 * actions to the shared {@link ComputerTranslator}, which coalesces writes
 * into Kernel batch calls and interleaves `url()` / `screenshot()` reads.
 */
export function createBatchTool(translator: ComputerTranslator): AgentTool<typeof BatchSchema, BatchToolDetails> {
	return {
		name: OPENAI_BATCH_TOOL_NAME,
		label: OPENAI_BATCH_TOOL_NAME,
		description: OPENAI_BATCH_DESCRIPTION,
		parameters: BatchSchema,
		async execute(_toolCallId, params): Promise<AgentToolResult<BatchToolDetails>> {
			const result = await executeOpenAIBatch(translator, params);
			const content = result.content as (TextContent | ImageContent)[];
			const details = result.details;
			if (result.isError) {
				const message = details.error ?? details.statusText;
				throw Object.assign(new Error(message), { details, content });
			}
			return { content, details };
		},
	};
}
