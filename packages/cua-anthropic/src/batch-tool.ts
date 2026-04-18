import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ImageContent, TextContent } from "@mariozechner/pi-ai";
import type { ComputerTranslator } from "@onkernel/cua-translator";
import {
	AnthropicBatchSchema,
	type AnthropicBatchToolDetails,
	executeAnthropicBatch,
	ANTHROPIC_BATCH_DESCRIPTION,
	ANTHROPIC_BATCH_TOOL_NAME,
} from "./batch.js";

/**
 * Anthropic-flavored `batch_computer_actions` tool.
 *
 * Anthropic accepts custom function tools with a JSON Schema `input_schema`
 * field on the Messages API. We reuse the SAME canonical action union as
 * the OpenAI batch tool (with the `keys` modifier renamed appropriately
 * for action shapes that match Anthropic's vocabulary), so a single
 * `ComputerTranslator.executeBatch` call can service the actions.
 *
 * The schema covers BOTH:
 *   - Anthropic's official `computer_20251124` action vocabulary (so the
 *     model can express the same things via batch as via the built-in
 *     tool, but in one round-trip).
 *   - cua extension actions (`goto`, `back`, `forward`, `url`).
 *
 * Coordinate convention here matches the OpenAI/canonical convention:
 * `x` and `y` numbers, NOT Anthropic's `coordinate: [x, y]` tuple. The
 * batch tool's preamble in `system-prompt.ts` documents this so the
 * model picks the right shape.
 */

/**
 * Build the `batch_computer_actions` AgentTool for Anthropic. Registered
 * alongside the built-in `computer` tool — the system prompt nudges the
 * model towards this one for predictable sequences.
 *
 * Set `enabled: false` (or omit from the tool list) to ship Anthropic
 * with only the built-in `computer` tool.
 */
export function createAnthropicBatchTool(
	translator: ComputerTranslator,
): AgentTool<typeof AnthropicBatchSchema, AnthropicBatchToolDetails> {
	return {
		name: ANTHROPIC_BATCH_TOOL_NAME,
		label: ANTHROPIC_BATCH_TOOL_NAME,
		description: ANTHROPIC_BATCH_DESCRIPTION,
		parameters: AnthropicBatchSchema,
		async execute(_id, params): Promise<AgentToolResult<AnthropicBatchToolDetails>> {
			const result = await executeAnthropicBatch(translator, params);
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
