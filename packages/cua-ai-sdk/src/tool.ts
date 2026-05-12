import type Kernel from "@onkernel/sdk";
import { ComputerTranslator } from "@onkernel/cua-translator";
import { type ComputerActionInput, type ComputerActionResult, translateToModelActions } from "./map.js";

const SETTLE_MS = 300;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface KernelComputerToolOptions {
	/** Kernel SDK client. */
	client: Kernel;
	/** Browser session ID. */
	sessionId: string;
	/** Display width in pixels (passed to the provider tool factory). */
	displayWidthPx: number;
	/** Display height in pixels (passed to the provider tool factory). */
	displayHeightPx: number;
}

/**
 * Create the `execute` and `toModelOutput` functions for an AI SDK
 * provider-defined computer tool that routes actions through a Kernel
 * browser.
 *
 * Use with `anthropic.tools.computer_20250124()` or
 * `anthropic.tools.computer_20251124()`:
 *
 * ```ts
 * import { anthropic } from '@ai-sdk/anthropic';
 * import { createKernelExecute } from '@onkernel/cua-ai-sdk';
 *
 * const { execute, toModelOutput } = createKernelExecute({
 *   client: kernel,
 *   sessionId: 'abc123',
 * });
 *
 * const tool = anthropic.tools.computer_20251124({
 *   displayWidthPx: 1280,
 *   displayHeightPx: 800,
 *   execute,
 *   toModelOutput,
 * });
 * ```
 */
export function createKernelExecute(opts: {
	client: Kernel;
	sessionId: string;
}) {
	const translator = new ComputerTranslator({
		client: opts.client,
		sessionId: opts.sessionId,
	});

	async function execute(input: ComputerActionInput): Promise<ComputerActionResult> {
		const actions = translateToModelActions(input);

		if (actions.length === 0) {
			const png = await translator.screenshotBase64();
			return { type: "image", data: png };
		}

		const result = await translator.executeBatch(actions);

		for (const read of result.readResults) {
			if (read.type === "screenshot") {
				return { type: "image", data: read.pngBytes.toString("base64") };
			}
			if (read.type === "url") {
				return { type: "text", text: `url: ${read.url}` };
			}
			if (read.type === "cursor_position") {
				return { type: "text", text: `X=${read.x},Y=${read.y}` };
			}
		}

		await delay(SETTLE_MS);
		const png = await translator.screenshotBase64();
		return { type: "image", data: png };
	}

	function toModelOutput({ output }: { toolCallId: string; input: unknown; output: ComputerActionResult }) {
		if (output.type === "image") {
			return {
				type: "content" as const,
				value: [{
					type: "file-data" as const,
					data: output.data,
					mediaType: "image/png",
				}],
			};
		}
		return { type: "text" as const, value: output.text };
	}

	return { execute, toModelOutput };
}

/**
 * Batteries-included: returns an Anthropic provider-defined computer tool
 * with `execute` pre-wired to a Kernel browser session.
 *
 * Requires `@ai-sdk/anthropic` as a peer dependency.
 *
 * ```ts
 * import { kernelComputerTool } from '@onkernel/cua-ai-sdk';
 * import { generateText } from 'ai';
 * import { anthropic } from '@ai-sdk/anthropic';
 *
 * const result = await generateText({
 *   model: anthropic('claude-sonnet-4-5-20250929'),
 *   tools: {
 *     computer: await kernelComputerTool({
 *       client: kernel,
 *       sessionId: 'abc123',
 *       displayWidthPx: 1280,
 *       displayHeightPx: 800,
 *     }),
 *   },
 *   maxSteps: 30,
 *   prompt: 'Navigate to the login page',
 * });
 * ```
 */
export async function kernelComputerTool(opts: KernelComputerToolOptions) {
	const { execute, toModelOutput } = createKernelExecute({
		client: opts.client,
		sessionId: opts.sessionId,
	});

	const { anthropic } = await import("@ai-sdk/anthropic");

	return anthropic.tools.computer_20251124({
		displayWidthPx: opts.displayWidthPx,
		displayHeightPx: opts.displayHeightPx,
		execute,
		toModelOutput,
	});
}
