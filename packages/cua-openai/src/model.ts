import type {
	ComputerTranslator,
	ComputerUseModel,
	ComputerUseRunResult,
	ComputerUseToolResult,
	ModelAction,
} from "@onkernel/cua-translator";
import OpenAI from "openai";
import type {
	ResponseComputerToolCall,
	ResponseComputerToolCallOutputItem,
	ResponseFunctionToolCallItem,
	ResponseFunctionToolCallOutputItem,
	Response,
	ResponseInputItem,
	ResponseItem,
	ResponseOutputMessage,
	Tool,
} from "openai/resources/responses/responses";
import { type BatchToolDetails, type BatchToolInput, executeOpenAIBatch, OPENAI_BATCH_TOOL } from "./batch.js";
import { type ExtraToolDetails, type ExtraToolInput, executeOpenAIExtraAction, OPENAI_EXTRA_TOOL } from "./extra.js";
import { OPENAI_BATCH_INSTRUCTIONS, OPENAI_NATIVE_COMPUTER_INSTRUCTIONS } from "./system-prompt.js";

const OPENAI_COMPUTER_TOOL = { type: "computer" } as const;
const POST_ACTION_SETTLE_MS = 300;
const DEFAULT_COMPACT_THRESHOLD = 200_000;
const OPENAI_BATCH_ONLY_INSTRUCTIONS = `You also have batch_computer_actions for predictable multi-step sequences.

Prefer batch_computer_actions when:
- Typing text followed by pressing Enter
- Clicking a field and then typing into it
- Dragging an item from one location to another
- Mixing writes with explicit url() or screenshot() readbacks

Use explicit url() and screenshot() steps inside batch_computer_actions when you need
intermediate readbacks. If you do not include explicit read steps, the batch
tool still returns one fresh screenshot after execution.`;
const OPENAI_EXTRA_ONLY_INSTRUCTIONS = `You also have computer_use_extra for high-level browser actions:
- action="goto" with url to navigate via keyboard-only browser navigation
- action="back" to go back in history
- action="url" to read the exact current URL`;

export interface OpenAIModelOptions {
	apiKey?: string;
	baseUrl?: string;
	instructions?: string;
	includeBatchTool?: boolean;
	includeExtraTool?: boolean;
	reasoningEffort?: "low" | "medium" | "high";
	/** Seed a Responses API chain. Use the prior response id returned in run details. */
	previousResponseId?: string;
	/** Set false to use stateless input-array chaining. Defaults to true. */
	usePreviousResponseId?: boolean;
	/** Server-side compaction threshold in rendered tokens. Set false to disable. Defaults to 200000. */
	compactThreshold?: number | false;
	/** Forwarded to OpenAI Responses. Leave undefined to use the API default. */
	store?: boolean;
}

export interface OpenAIToolCallResultDetails {
	toolName: string;
	toolDetails?: BatchToolDetails | ExtraToolDetails;
}

export interface OpenAIModelRunDetails {
	responseId?: string;
}

export type OpenAIToolSpec = typeof OPENAI_COMPUTER_TOOL | typeof OPENAI_BATCH_TOOL | typeof OPENAI_EXTRA_TOOL;

export function openaiTools(opts: {
	includeNativeComputer?: boolean;
	includeBatchTool?: boolean;
	includeExtraTool?: boolean;
} = {}): OpenAIToolSpec[] {
	const tools: OpenAIToolSpec[] = [];
	if (opts.includeNativeComputer !== false) tools.push(OPENAI_COMPUTER_TOOL);
	if (opts.includeBatchTool !== false) tools.push(OPENAI_BATCH_TOOL);
	if (opts.includeExtraTool !== false) tools.push(OPENAI_EXTRA_TOOL);
	return tools;
}

export async function executeOpenAIToolCall(args: {
	translator: ComputerTranslator;
	name: string;
	arguments: unknown;
}): Promise<ComputerUseToolResult<BatchToolDetails | ExtraToolDetails>> {
	const parsed = parseFunctionArguments(args.arguments);
	switch (args.name) {
		case OPENAI_BATCH_TOOL.name:
			return executeOpenAIBatch(args.translator, parsed as BatchToolInput);
		case OPENAI_EXTRA_TOOL.name:
			return executeOpenAIExtraAction(args.translator, parsed as ExtraToolInput);
		default:
			throw new Error(`unknown OpenAI tool call "${args.name}"`);
	}
}

export function openai(modelId: string, opts: OpenAIModelOptions = {}): ComputerUseModel<OpenAIModelRunDetails> {
	return {
		provider: "openai",
		modelId,
		async run({ prompt, translator, maxTurns = 50 }): Promise<ComputerUseRunResult<OpenAIModelRunDetails>> {
			const apiKey = opts.apiKey || process.env.OPENAI_API_KEY;
			if (!apiKey) {
				throw new Error("missing OpenAI API key");
			}
			const client = new OpenAI({
				apiKey,
				...(opts.baseUrl ? { baseURL: opts.baseUrl } : {}),
			});

			const instructions = composeInstructions(opts);
			const initialInput: ResponseInputItem[] = [
				{
					role: "user",
					content: [makeTextInput(prompt)],
				} as unknown as ResponseInputItem,
			];
			const statelessInput = initialInput;
			const followUps: ResponseItem[] = [];
			const usePreviousResponseId = opts.usePreviousResponseId !== false;
			let previousResponseId = opts.previousResponseId;
			let nextInput = initialInput;

			for (let turn = 0; turn < maxTurns; turn++) {
				const request = {
					model: modelId,
					instructions,
					input: usePreviousResponseId ? nextInput : ([...statelessInput, ...followUps] as ResponseInputItem[]),
					tools: openaiTools({
						includeNativeComputer: true,
						includeBatchTool: opts.includeBatchTool !== false,
						includeExtraTool: opts.includeExtraTool !== false,
					}) as unknown as Tool[],
					parallel_tool_calls: false,
					truncation: "auto",
					reasoning: {
						effort: opts.reasoningEffort ?? "low",
						summary: "concise",
					},
					...(usePreviousResponseId && previousResponseId ? { previous_response_id: previousResponseId } : {}),
					...(opts.store !== undefined ? { store: opts.store } : {}),
					...contextManagementOption(opts.compactThreshold),
				};

				const response = (await client.responses.create(
					request as Parameters<typeof client.responses.create>[0],
				)) as Response;
				if (response.id) previousResponseId = response.id;
				nextInput = [];

				const output = response.output ?? [];
				let sawToolCall = false;

				for (const item of output) {
					if (!usePreviousResponseId) followUps.push(item as ResponseItem);
					if (item.type === "computer_call") {
						sawToolCall = true;
						const toolOutputs = await handleComputerCall(translator, item as ResponseComputerToolCall);
						if (usePreviousResponseId) {
							nextInput.push(...(toolOutputs as unknown as ResponseInputItem[]));
						} else {
							followUps.push(...toolOutputs);
						}
						continue;
					}
					if (item.type === "function_call") {
						sawToolCall = true;
						const toolOutput = await handleFunctionCall(translator, item as ResponseFunctionToolCallItem);
						if (usePreviousResponseId) {
							nextInput.push(toolOutput as unknown as ResponseInputItem);
						} else {
							followUps.push(toolOutput);
						}
					}
				}

				if (!sawToolCall) {
					return {
						text: response.output_text || extractTextFromOutput(output),
						provider: "openai",
						modelId,
						turns: turn + 1,
						details: response.id ? { responseId: response.id } : undefined,
					};
				}
			}

			return {
				text: "(max turns reached)",
				provider: "openai",
				modelId,
				turns: maxTurns,
			};
		},
	};
}

function contextManagementOption(compactThreshold: OpenAIModelOptions["compactThreshold"]): Record<string, unknown> {
	if (compactThreshold === false) return {};
	return {
		context_management: [
			{
				type: "compaction",
				compact_threshold: compactThreshold ?? DEFAULT_COMPACT_THRESHOLD,
			},
		],
	};
}

function composeInstructions(opts: OpenAIModelOptions): string {
	const sections = [OPENAI_NATIVE_COMPUTER_INSTRUCTIONS];
	const includeBatch = opts.includeBatchTool !== false;
	const includeExtra = opts.includeExtraTool !== false;
	if (includeBatch && includeExtra) {
		sections.push(OPENAI_BATCH_INSTRUCTIONS);
	} else {
		if (includeBatch) sections.push(OPENAI_BATCH_ONLY_INSTRUCTIONS);
		if (includeExtra) sections.push(OPENAI_EXTRA_ONLY_INSTRUCTIONS);
	}
	const trimmed = (opts.instructions ?? "").trim();
	if (trimmed) sections.push(trimmed);
	return sections.join("\n\n");
}

function makeTextInput(text: string): { type: "input_text"; text: string } {
	return { type: "input_text", text };
}

function parseFunctionArguments(value: unknown): Record<string, unknown> {
	if (typeof value === "string" && value.trim()) {
		return JSON.parse(value) as Record<string, unknown>;
	}
	if (value && typeof value === "object") {
		return value as Record<string, unknown>;
	}
	return {};
}

async function handleFunctionCall(
	translator: ComputerTranslator,
	item: ResponseFunctionToolCallItem,
): Promise<ResponseItem> {
	const result = await executeOpenAIToolCall({
		translator,
		name: item.name,
		arguments: item.arguments,
	});
	return {
		type: "function_call_output",
		call_id: item.call_id,
		output: toOpenAIInputParts(result),
	} as unknown as ResponseFunctionToolCallOutputItem;
}

async function handleComputerCall(
	translator: ComputerTranslator,
	item: ResponseComputerToolCall,
): Promise<ResponseItem[]> {
	const call = item as ResponseComputerToolCall & {
		action?: Record<string, unknown>;
		actions?: Array<Record<string, unknown>>;
		pending_safety_checks?: unknown[];
	};
	const actions = Array.isArray(call.actions) ? call.actions : call.action ? [call.action] : [];
	if (actions.length > 0) {
		await translator.executeBatch(actions as ModelAction[]);
	}
	await delay(POST_ACTION_SETTLE_MS);
	const screenshot = await translator.screenshotBase64();
	return [
		{
			type: "computer_call_output",
			call_id: call.call_id,
			acknowledged_safety_checks: Array.isArray(call.pending_safety_checks) ? call.pending_safety_checks : [],
			output: {
				type: "computer_screenshot",
				image_url: `data:image/png;base64,${screenshot}`,
			},
		} as unknown as ResponseComputerToolCallOutputItem,
	];
}

function toOpenAIInputParts(result: ComputerUseToolResult<unknown>): Array<Record<string, unknown>> {
	return result.content.map((part) =>
		part.type === "text"
			? {
					type: "input_text",
					text: part.text,
				}
			: {
					type: "input_image",
					image_url: `data:${part.mimeType};base64,${part.data}`,
					detail: "original",
				},
	);
}

function extractTextFromOutput(
	output: ReadonlyArray<
		| ResponseItem
		| {
				type?: string;
				role?: string;
				content?: unknown[];
		  }
		| undefined
	>,
): string {
	const pieces: string[] = [];
	for (const item of output) {
		if (!item || item.type !== "message") continue;
		const message = item as ResponseOutputMessage;
		if (message.role !== "assistant") continue;
		for (const block of message.content ?? []) {
			if (block && typeof block === "object" && "text" in block && typeof block.text === "string") {
				pieces.push(block.text);
			}
		}
	}
	return pieces.join("\n").trim();
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
