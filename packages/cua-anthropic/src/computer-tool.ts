import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ImageContent, TextContent } from "@mariozechner/pi-ai";
import type { ComputerTranslator } from "@onkernel/cua-translator";
import {
	ComputerSchema,
	type AnthropicComputerDetails,
	executeAnthropicComputerAction,
} from "./computer.js";

/**
 * Build the `computer` AgentTool for Anthropic. The provider payload hook
 * swaps this function tool for Anthropic's built-in `computer_20251124`
 * spec on the wire; locally we route the tool use through the shared
 * Kernel-backed execution helper.
 */
export function createAnthropicComputerTool(
	translator: ComputerTranslator,
): AgentTool<typeof ComputerSchema, AnthropicComputerDetails> {
	return {
		name: "computer",
		label: "computer",
		description:
			"Anthropic built-in computer use tool. Spec is injected by the provider; this AgentTool routes tool_use blocks to our Kernel-backed translator.",
		parameters: ComputerSchema,
		async execute(_id, params): Promise<AgentToolResult<AnthropicComputerDetails>> {
			const result = await executeAnthropicComputerAction(translator, params);
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
