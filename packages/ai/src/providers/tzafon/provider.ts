import {
	createAssistantMessageEventStream,
	type Api,
	type AssistantMessage,
	type Context,
	type ImageContent,
	type Model,
	type SimpleStreamOptions,
	type StreamFunction,
	type StreamOptions,
	type TextContent,
	type Tool,
	type ToolCall,
} from "@mariozechner/pi-ai";
import Lightcone from "@tzafon/lightcone";

export const TZAFON_RESPONSES_API = "tzafon-responses";

export interface TzafonResponsesOptions extends StreamOptions {
	maxOutputTokens?: number;
}

export const streamSimpleTzafonResponses: StreamFunction<string, SimpleStreamOptions> = (model, context, options) => {
	return streamTzafonResponses(model, context, options);
};

export const streamTzafonResponses: StreamFunction<string, TzafonResponsesOptions> = (model, context, options) => {
	const stream = createAssistantMessageEventStream();
	const output = initialAssistantMessage(model);

	void (async () => {
		try {
			const apiKey = options?.apiKey || process.env.TZAFON_API_KEY;
			if (!apiKey) throw new Error(`No API key for provider: ${model.provider}`);
			const client = new Lightcone({ apiKey });
			const payload = {
				model: model.id,
				input: convertContextMessages(context),
				tools: convertTools(context.tools ?? []),
				instructions: context.systemPrompt,
				temperature: options?.temperature ?? 0,
				max_output_tokens: options?.maxOutputTokens ?? options?.maxTokens ?? model.maxTokens,
			};
			const nextPayload = await options?.onPayload?.(payload, model as Model<Api>);
			if (options?.signal?.aborted) throw new Error("Request was aborted");
			const response = await client.responses.create((nextPayload ?? payload) as never, { signal: options?.signal });
			if (options?.signal?.aborted) throw new Error("Request was aborted");

			stream.push({ type: "start", partial: output });
			for (const item of getArray(response, "output")) {
				const type = getString(item, "type");
				if (type === "message") {
					const text = extractMessageText(item);
					if (text) emitText(stream, output, text);
					continue;
				}
				if (type === "function_call") {
					emitToolCall(stream, output, {
						type: "toolCall",
						id: getString(item, "call_id"),
						name: getString(item, "name"),
						arguments: parseArguments(getValue(item, "arguments")),
					});
				}
			}

			output.stopReason = output.content.some((part) => part.type === "toolCall") ? "toolUse" : "stop";
			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (err) {
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = err instanceof Error ? err.message : String(err);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
};

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

function emitText(stream: ReturnType<typeof createAssistantMessageEventStream>, output: AssistantMessage, text: string): void {
	const contentIndex = output.content.length;
	const content: TextContent = { type: "text", text };
	output.content.push(content);
	stream.push({ type: "text_start", contentIndex, partial: output });
	stream.push({ type: "text_delta", contentIndex, delta: text, partial: output });
	stream.push({ type: "text_end", contentIndex, content: text, partial: output });
}

function emitToolCall(
	stream: ReturnType<typeof createAssistantMessageEventStream>,
	output: AssistantMessage,
	toolCall: ToolCall,
): void {
	const contentIndex = output.content.length;
	output.content.push(toolCall);
	stream.push({ type: "toolcall_start", contentIndex, partial: output });
	stream.push({ type: "toolcall_end", contentIndex, toolCall, partial: output });
}

function convertTools(tools: Tool[]): Array<Record<string, unknown>> {
	return tools.map((tool) => ({
		type: "function",
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters,
	}));
}

function convertContextMessages(context: Context): Array<Record<string, unknown>> {
	const items: Array<Record<string, unknown>> = [];
	for (const message of context.messages) {
		if (message.role === "user") {
			items.push({ role: "user", content: convertUserContent(message.content) });
			continue;
		}
		if (message.role === "assistant") {
			const text = message.content
				.filter((part): part is TextContent => part.type === "text")
				.map((part) => part.text)
				.join("\n")
				.trim();
			if (text) items.push({ role: "assistant", content: text });
			for (const part of message.content) {
				if (part.type !== "toolCall") continue;
				items.push({
					type: "function_call",
					call_id: part.id,
					name: part.name,
					arguments: JSON.stringify(part.arguments ?? {}),
				});
			}
			continue;
		}
		if (message.role === "toolResult") {
			const text = message.content
				.filter((part): part is TextContent => part.type === "text")
				.map((part) => part.text)
				.join("\n")
				.trim();
			items.push({
				type: "function_call_output",
				call_id: message.toolCallId,
				output: message.isError ? `Error: ${text || "tool execution failed"}` : text || "ok",
			});
			const image = [...message.content].reverse().find((part): part is ImageContent => part.type === "image");
			if (image) {
				items.push({
					role: "user",
					content: [
						{ type: "input_text", text: "screenshot" },
						{ type: "input_image", image_url: `data:${image.mimeType};base64,${image.data}`, detail: "auto" },
					],
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

function parseArguments(value: unknown): Record<string, unknown> {
	if (typeof value === "string" && value.trim()) {
		try {
			const parsed = JSON.parse(value);
			return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
		} catch {
			return {};
		}
	}
	if (value && typeof value === "object") return value as Record<string, unknown>;
	return {};
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
