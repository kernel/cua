import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ImageContent, TextContent } from "@mariozechner/pi-ai";
import type { ComputerTranslator } from "@onkernel/cua-translator";
import {
	executeOpenAIExtraAction,
	ExtraSchema,
	type ExtraToolDetails,
	OPENAI_EXTRA_TOOL_DESCRIPTION,
	OPENAI_EXTRA_TOOL_NAME,
} from "./extra";

/**
 * Build the `computer_use_extra` AgentTool. High-level browser navigation
 * convenience wrapper for the cua-added actions: `goto`, `back`, and
 * `url`. Each call returns a screenshot of the resulting page so the
 * model can see what happened.
 *
 * This tool is NOT part of OpenAI's official `computer` tool surface — it
 * is registered alongside `batch_computer_actions` for situations where
 * the model just needs one navigation verb without batching.
 */
export function createExtraTool(translator: ComputerTranslator): AgentTool<typeof ExtraSchema, ExtraToolDetails> {
	return {
		name: OPENAI_EXTRA_TOOL_NAME,
		label: OPENAI_EXTRA_TOOL_NAME,
		description: OPENAI_EXTRA_TOOL_DESCRIPTION,
		parameters: ExtraSchema,
		async execute(_id, params): Promise<AgentToolResult<ExtraToolDetails>> {
			const result = await executeOpenAIExtraAction(translator, params);
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
