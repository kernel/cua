import OpenAI from "openai";
import type { ResponseStreamEvent } from "openai/resources/responses/responses";
import {
	clampThinkingLevel,
	createAssistantMessageEventStream,
	parseStreamingJson,
	type Api,
	type AssistantMessage,
	type Context,
	type ImageContent,
	type Message,
	type Model,
	type SimpleStreamOptions,
	type StreamFunction,
	type StreamOptions,
	type TextContent,
	type ToolCall,
} from "@earendil-works/pi-ai";
import { responseThreadingDelta, responseThreadingEnabled, type ResponseThreadingOptions } from "../common";

export const OPENAI_CUA_RESPONSES_API = "openai-cua-responses";

/** Stream options accepted by {@link streamOpenAIResponses}. */
export interface OpenAIResponsesOptions extends StreamOptions, ResponseThreadingOptions {
	reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
	reasoningSummary?: "auto" | "detailed" | "concise" | null;
}

/** Inputs {@link buildOpenAIRequestInput} reads to shape the Responses API request body. */
export interface OpenAIRequestOptions extends ResponseThreadingOptions {
	temperature?: number;
	maxTokens?: number;
	reasoningEffort?: OpenAIResponsesOptions["reasoningEffort"];
	reasoningSummary?: OpenAIResponsesOptions["reasoningSummary"];
}

/** Responses API request body for {@link OpenAI.responses.create}, including optional threading fields. */
export interface OpenAIRequestBody {
	model: string;
	input: Array<Record<string, unknown>>;
	tools: Array<Record<string, unknown>>;
	instructions?: string;
	stream: true;
	store: boolean;
	temperature?: number;
	max_output_tokens?: number;
	reasoning?: { effort?: string; summary?: string };
	include?: string[];
	previous_response_id?: string;
}

/**
 * Build the OpenAI Responses API request body from a context.
 *
 * Pure and network-free. The public OpenAI Responses API requires `store: true`
 * for `previous_response_id` continuity, so the body always stores. When
 * response threading is enabled and a prior assistant `responseId` exists, the
 * body chains via `previous_response_id` and sends only the delta messages;
 * otherwise it replays the full message history.
 */
export function buildOpenAIRequestInput(model: Model<Api>, context: Context, options?: OpenAIRequestOptions): OpenAIRequestBody {
	const body: OpenAIRequestBody = {
		model: model.id,
		input: convertMessages(context.messages),
		tools: convertTools(context.tools ?? []),
		instructions: context.systemPrompt,
		stream: true,
		store: true,
		max_output_tokens: options?.maxTokens ?? model.maxTokens,
	};
	if (options?.temperature !== undefined) body.temperature = options.temperature;
	if (model.reasoning && (options?.reasoningEffort || options?.reasoningSummary)) {
		const effort = options.reasoningEffort
			? (model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort)
			: "medium";
		body.reasoning = { effort, summary: options.reasoningSummary ?? "auto" };
		body.include = ["reasoning.encrypted_content"];
	}
	if (!responseThreadingEnabled(options)) return body;
	const { previousResponseId, deltaMessages } = responseThreadingDelta(context.messages);
	if (!previousResponseId) return body;
	return { ...body, input: convertMessages(deltaMessages), previous_response_id: previousResponseId };
}

export const streamSimpleOpenAIResponses: StreamFunction<typeof OPENAI_CUA_RESPONSES_API, SimpleStreamOptions> = (model, context, options) => {
	const clamped = options?.reasoning ? clampThinkingLevel(model, options.reasoning) : undefined;
	const reasoningEffort = clamped && clamped !== "off" ? clamped : undefined;
	return streamOpenAIResponses(model, context, { ...options, reasoningEffort });
};

export const streamOpenAIResponses: StreamFunction<typeof OPENAI_CUA_RESPONSES_API, OpenAIResponsesOptions> = (model, context, options) => {
	const stream = createAssistantMessageEventStream();
	const output = initialAssistantMessage(model);

	void (async () => {
		try {
			const apiKey = options?.apiKey || process.env.OPENAI_API_KEY;
			if (!apiKey) throw new Error(`No API key for provider: ${model.provider}`);
			const client = new OpenAI({ apiKey, baseURL: model.baseUrl, dangerouslyAllowBrowser: true, defaultHeaders: model.headers });
			const payload = buildOpenAIRequestInput(model as Model<Api>, context, options);
			const nextPayload = await options?.onPayload?.(payload, model as Model<Api>);
			if (options?.signal?.aborted) throw new Error("Request was aborted");
			const responseStream = await client.responses.create((nextPayload ?? payload) as never, {
				signal: options?.signal,
				...(options?.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
				maxRetries: options?.maxRetries ?? 0,
			});

			stream.push({ type: "start", partial: output });
			await processStream(responseStream as unknown as AsyncIterable<ResponseStreamEvent>, output, stream, options?.signal);
			if (options?.signal?.aborted) throw new Error("Request was aborted");

			stream.push({ type: "done", reason: output.stopReason as "stop" | "length" | "toolUse", message: output });
			stream.end();
		} catch (err) {
			for (const block of output.content) {
				delete (block as { partialJson?: string }).partialJson;
			}
			// An errored/aborted turn may have captured a responseId from an incomplete
			// response; drop it so it never anchors `previous_response_id` next turn.
			output.responseId = undefined;
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = err instanceof Error ? err.message : String(err);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
};

async function processStream(
	events: AsyncIterable<ResponseStreamEvent>,
	output: AssistantMessage,
	stream: ReturnType<typeof createAssistantMessageEventStream>,
	signal?: AbortSignal,
): Promise<void> {
	let current: { kind: "text" | "toolCall"; index: number; partialJson: string } | null = null;
	const blockIndex = () => output.content.length - 1;
	for await (const event of events) {
		if (signal?.aborted) throw new Error("Request was aborted");
		const type = getString(event, "type");
		if (type === "response.created") {
			output.responseId = getString(getValue(event, "response"), "id") || output.responseId;
		} else if (type === "response.output_item.added") {
			const item = getValue(event, "item");
			const itemType = getString(item, "type");
			if (itemType === "message") {
				output.content.push({ type: "text", text: "" });
				current = { kind: "text", index: blockIndex(), partialJson: "" };
				stream.push({ type: "text_start", contentIndex: current.index, partial: output });
			} else if (itemType === "function_call") {
				const toolCall: ToolCall = {
					type: "toolCall",
					id: openaiToolCallId(item),
					name: getString(item, "name"),
					arguments: {},
				};
				(toolCall as ToolCall & { partialJson?: string }).partialJson = getString(item, "arguments");
				output.content.push(toolCall);
				current = { kind: "toolCall", index: blockIndex(), partialJson: getString(item, "arguments") };
				stream.push({ type: "toolcall_start", contentIndex: current.index, partial: output });
			}
		} else if (type === "response.output_text.delta") {
			if (current?.kind === "text") {
				const delta = getString(event, "delta");
				const block = output.content[current.index] as TextContent;
				block.text += delta;
				stream.push({ type: "text_delta", contentIndex: current.index, delta, partial: output });
			}
		} else if (type === "response.function_call_arguments.delta") {
			if (current?.kind === "toolCall") {
				const delta = getString(event, "delta");
				current.partialJson += delta;
				const block = output.content[current.index] as ToolCall;
				block.arguments = parseStreamingJson(current.partialJson);
				stream.push({ type: "toolcall_delta", contentIndex: current.index, delta, partial: output });
			}
		} else if (type === "response.output_item.done") {
			const item = getValue(event, "item");
			const itemType = getString(item, "type");
			if (itemType === "message" && current?.kind === "text") {
				const block = output.content[current.index] as TextContent;
				block.text = extractMessageText(item) || block.text;
				stream.push({ type: "text_end", contentIndex: current.index, content: block.text, partial: output });
				current = null;
			} else if (itemType === "function_call" && current?.kind === "toolCall") {
				const block = output.content[current.index] as ToolCall & { partialJson?: string };
				block.arguments = parseStreamingJson(block.partialJson || getString(item, "arguments") || "{}");
				delete block.partialJson;
				stream.push({ type: "toolcall_end", contentIndex: current.index, toolCall: block, partial: output });
				current = null;
			}
		} else if (type === "response.completed" || type === "response.incomplete") {
			const response = getValue(event, "response");
			output.responseId = getString(response, "id") || output.responseId;
			output.usage = usageFromOpenAI(getValue(response, "usage"));
			output.stopReason = type === "response.incomplete" ? "length" : "stop";
		} else if (type === "error") {
			throw new Error(getString(event, "message") || `OpenAI error code ${getString(event, "code")}`);
		} else if (type === "response.failed") {
			const error = getValue(getValue(event, "response"), "error");
			throw new Error(getString(error, "message") || "OpenAI response failed");
		}
	}
	if (output.content.some((part) => part.type === "toolCall") && output.stopReason === "stop") {
		output.stopReason = "toolUse";
	}
}

/** Pair an OpenAI function-call item's `call_id` with its item `id` so pi-ai can round-trip the Responses item. */
function openaiToolCallId(item: unknown): string {
	const callId = getString(item, "call_id");
	const id = getString(item, "id");
	return id ? `${callId}|${id}` : callId;
}

function initialAssistantMessage(model: Model<string>): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function convertTools(tools: { name: string; description?: string; parameters?: unknown }[]): Array<Record<string, unknown>> {
	return tools.map((tool) => ({
		type: "function",
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters,
		strict: false,
	}));
}

function convertMessages(messages: readonly Message[]): Array<Record<string, unknown>> {
	const items: Array<Record<string, unknown>> = [];
	for (const message of messages) {
		if (message.role === "user") {
			items.push({ role: "user", content: convertUserContent(message.content) });
			continue;
		}
		if (message.role === "assistant") {
			for (const part of message.content) {
				if (part.type === "text" && part.text.trim()) {
					items.push({
						type: "message",
						role: "assistant",
						content: [{ type: "output_text", text: part.text, annotations: [] }],
						status: "completed",
					});
				} else if (part.type === "toolCall") {
					const [callId, itemId] = part.id.split("|");
					items.push({
						type: "function_call",
						...(itemId ? { id: itemId } : {}),
						call_id: callId,
						name: part.name,
						arguments: JSON.stringify(part.arguments ?? {}),
					});
				}
			}
			continue;
		}
		if (message.role === "toolResult") {
			const text = message.content
				.filter((part): part is TextContent => part.type === "text")
				.map((part) => part.text)
				.join("\n")
				.trim();
			const images = message.content.filter((part): part is ImageContent => part.type === "image");
			const [callId] = message.toolCallId.split("|");
			if (images.length > 0) {
				const content: Array<Record<string, unknown>> = [];
				if (text) content.push({ type: "input_text", text });
				for (const image of images) {
					content.push({ type: "input_image", image_url: `data:${image.mimeType};base64,${image.data}`, detail: "auto" });
				}
				items.push({ type: "function_call_output", call_id: callId, output: content });
			} else {
				items.push({
					type: "function_call_output",
					call_id: callId,
					output: message.isError ? `Error: ${text || "tool execution failed"}` : text || "ok",
				});
			}
		}
	}
	return items;
}

function convertUserContent(content: string | (TextContent | ImageContent)[]): unknown {
	if (typeof content === "string") return [{ type: "input_text", text: content }];
	return content.map((part) => {
		if (part.type === "text") return { type: "input_text", text: part.text };
		return { type: "input_image", image_url: `data:${part.mimeType};base64,${part.data}`, detail: "auto" };
	});
}

function extractMessageText(item: unknown): string {
	return getArray(item, "content")
		.map((block) => getString(block, "text"))
		.filter(Boolean)
		.join("\n")
		.trim();
}

function usageFromOpenAI(usage: unknown): AssistantMessage["usage"] {
	const input = readUsageNumber(usage, "input_tokens");
	const output = readUsageNumber(usage, "output_tokens");
	const cacheRead = readUsageNumber(getValue(usage, "input_tokens_details"), "cached_tokens");
	const totalTokens = readUsageNumber(usage, "total_tokens") || input + output;
	return {
		input: Math.max(0, input - cacheRead),
		output,
		cacheRead,
		cacheWrite: 0,
		totalTokens,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function readUsageNumber(obj: unknown, key: string): number {
	return readOptionalNumber(obj, key) ?? 0;
}

function readOptionalNumber(obj: unknown, key: string): number | undefined {
	if (!obj || typeof obj !== "object") return undefined;
	const value = (obj as Record<string, unknown>)[key];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getArray(obj: unknown, key: string): unknown[] {
	const value = getValue(obj, key);
	return Array.isArray(value) ? value : [];
}

function getString(obj: unknown, key: string): string {
	const value = getValue(obj, key);
	return typeof value === "string" ? value : "";
}

function getValue(obj: unknown, key: string): unknown {
	if (!obj || typeof obj !== "object") return undefined;
	return (obj as Record<string, unknown>)[key];
}
