import type Kernel from "@onkernel/sdk";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { Tool } from "@mariozechner/pi-ai";
import {
	CUA_BATCH_TOOL_NAME,
	CUA_NAVIGATION_TOOL_NAME,
	anthropic,
	gemini,
	openai,
	tzafon,
	yutori,
	type CuaBatchInput,
	type CuaProvider,
	type CuaNavigationInput,
} from "@onkernel/cua-ai";
import { InternalComputerTranslator, type KernelBrowser } from "./translator/translator.js";
import type { ModelAction } from "./translator/types.js";

export interface ComputerToolOptions {
	browser: KernelBrowser;
	client?: Kernel;
}

export interface CuaComputerToolsOptions extends ComputerToolOptions {
	provider: CuaProvider;
}

export interface OpenAIComputerToolsOptions extends ComputerToolOptions {}
export interface AnthropicComputerToolsOptions extends ComputerToolOptions {}
export interface GeminiComputerToolsOptions extends ComputerToolOptions {}
export interface TzafonComputerToolsOptions extends ComputerToolOptions {}
export interface YutoriComputerToolsOptions extends ComputerToolOptions {}

export function createCuaComputerTools(args: CuaComputerToolsOptions): AgentTool<any, any>[] {
	switch (args.provider) {
		case "openai":
			return createOpenAIComputerTools(args);
		case "anthropic":
			return createAnthropicComputerTools(args);
		case "gemini":
			return createGeminiComputerTools(args);
		case "tzafon":
			return createTzafonComputerTools(args);
		case "yutori":
			return createYutoriComputerTools(args);
		default:
			throw new Error(`unsupported CUA provider: ${String(args.provider)}`);
	}
}

export function createOpenAIComputerTools(args: OpenAIComputerToolsOptions): AgentTool<any, any>[] {
	return createGenericComputerTools(args, openai.createComputerToolDefinitions());
}

export function createAnthropicComputerTools(args: AnthropicComputerToolsOptions): AgentTool<any, any>[] {
	return createGenericComputerTools(args, anthropic.createComputerToolDefinitions());
}

export function createGeminiComputerTools(args: GeminiComputerToolsOptions): AgentTool<any, any>[] {
	return createGenericComputerTools(args, gemini.createComputerToolDefinitions());
}

export function createTzafonComputerTools(args: TzafonComputerToolsOptions): AgentTool<any, any>[] {
	return createGenericComputerTools(args, tzafon.createComputerToolDefinitions());
}

export function createYutoriComputerTools(args: YutoriComputerToolsOptions): AgentTool<any, any>[] {
	return createGenericComputerTools(args, yutori.createComputerToolDefinitions());
}

function createGenericComputerTools(args: ComputerToolOptions, definitions: Tool[]): AgentTool<any, any>[] {
	const translator = new InternalComputerTranslator(args);
	return definitions.map((definition) => {
		if (definition.name === CUA_BATCH_TOOL_NAME) {
			return {
				name: definition.name,
				label: definition.name,
				description: definition.description,
				parameters: definition.parameters,
				async execute(_toolCallId, params): Promise<AgentToolResult<BatchDetails>> {
					const result = await executeBatchTool(translator, params as CuaBatchInput);
					if (result.isError) throw Object.assign(new Error(result.details.statusText), result);
					return { content: result.content, details: result.details };
				},
			};
		}
		if (definition.name === CUA_NAVIGATION_TOOL_NAME) {
			return {
				name: definition.name,
				label: definition.name,
				description: definition.description,
				parameters: definition.parameters,
				async execute(_toolCallId, params): Promise<AgentToolResult<NavigationDetails>> {
					const result = await executeNavigationTool(translator, params as CuaNavigationInput);
					if (result.isError) throw Object.assign(new Error(result.details.statusText), result);
					return { content: result.content, details: result.details };
				},
			};
		}
		throw new Error(`unsupported CUA computer tool definition: ${definition.name}`);
	});
}

interface BatchDetails {
	statusText: string;
	readResults: Array<{ type: "url"; url: string } | { type: "screenshot"; bytes: number } | { type: "cursor_position"; x: number; y: number }>;
	error?: string;
}

interface NavigationDetails {
	action: string;
	statusText: string;
	url?: string;
	error?: string;
}

async function executeBatchTool(translator: InternalComputerTranslator, params: CuaBatchInput) {
	const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];
	const readResults: BatchDetails["readResults"] = [];
	let statusText = "Actions executed successfully.";
	let error: Error | undefined;
	try {
		const result = await translator.executeBatch(params.actions as unknown as ModelAction[]);
		for (const read of result.readResults) {
			if (read.type === "url") {
				readResults.push({ type: "url", url: read.url });
				content.push({ type: "text", text: `url(): ${read.url}` });
			} else if (read.type === "cursor_position") {
				readResults.push({ type: "cursor_position", x: read.x, y: read.y });
				content.push({ type: "text", text: `cursor_position(): ${read.x},${read.y}` });
			} else {
				readResults.push({ type: "screenshot", bytes: read.pngBytes.length });
				content.push({ type: "image", data: read.pngBytes.toString("base64"), mimeType: "image/png" });
			}
		}
		if (content.length === 0) {
			const png = await translator.screenshotRaw();
			readResults.push({ type: "screenshot", bytes: png.length });
			content.push({ type: "image", data: png.toString("base64"), mimeType: "image/png" });
		}
	} catch (err) {
		error = err instanceof Error ? err : new Error(String(err));
		statusText = `Actions failed: ${error.message}`;
		content.push({ type: "text", text: statusText });
	}
	return { content, details: { statusText, readResults, ...(error ? { error: error.message } : {}) }, isError: Boolean(error) };
}

async function executeNavigationTool(translator: InternalComputerTranslator, params: CuaNavigationInput) {
	const action = params.action;
	const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];
	let statusText = "Action executed successfully.";
	let url: string | undefined;
	let error: Error | undefined;
	try {
		if (action === "url") {
			url = await translator.currentUrl();
			statusText = `Current URL: ${url}`;
		} else {
			await translator.executeBatch([{ type: action, url: params.url }]);
			statusText = `${action} executed successfully.`;
		}
		const png = await translator.screenshotRaw();
		content.push({ type: "image", data: png.toString("base64"), mimeType: "image/png" });
	} catch (err) {
		error = err instanceof Error ? err : new Error(String(err));
		statusText = `${action} failed: ${error.message}`;
	}
	content.unshift({ type: "text", text: statusText });
	return { content, details: { action, statusText, ...(url ? { url } : {}), ...(error ? { error: error.message } : {}) }, isError: Boolean(error) };
}
