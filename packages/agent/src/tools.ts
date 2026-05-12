import type Kernel from "@onkernel/sdk";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ImageContent, TextContent, Tool } from "@earendil-works/pi-ai";
import {
	CUA_BATCH_TOOL_NAME,
	CUA_NAVIGATION_TOOL_NAME,
	CuaBatchSchema,
	CuaNavigationSchema,
	type CuaBatchInput,
	type CuaNavigationInput,
} from "@onkernel/cua-ai";
import { InternalComputerTranslator, type KernelBrowser } from "./translator/translator.js";

export interface ComputerToolOptions {
	browser: KernelBrowser;
	client: Kernel;
	toolDefinitions: Tool[];
}

export const SUPPORTED_CUA_EXECUTOR_TOOL_NAMES = [CUA_BATCH_TOOL_NAME, CUA_NAVIGATION_TOOL_NAME] as const;
export type SupportedCuaExecutorToolName = (typeof SUPPORTED_CUA_EXECUTOR_TOOL_NAMES)[number];

type ToolContent = Array<TextContent | ImageContent>;

export interface BatchDetails {
	statusText: string;
	readResults: Array<{ type: "url"; url: string } | { type: "screenshot"; bytes: number } | { type: "cursor_position"; x: number; y: number }>;
	error?: string;
}

export interface NavigationDetails {
	action: string;
	statusText: string;
	url?: string;
	error?: string;
}

type BatchTool = AgentTool<typeof CuaBatchSchema, BatchDetails>;
type NavigationTool = AgentTool<typeof CuaNavigationSchema, NavigationDetails>;
export type CuaExecutorTool = BatchTool | NavigationTool;

export function createCuaComputerTools(args: ComputerToolOptions): CuaExecutorTool[] {
	const translator = new InternalComputerTranslator(args);
	return args.toolDefinitions.map((definition) => createExecutorTool(definition, translator));
}

function createExecutorTool(definition: Tool, translator: InternalComputerTranslator): CuaExecutorTool {
	if (definition.name === CUA_BATCH_TOOL_NAME) {
		const tool: BatchTool = {
			name: definition.name,
			label: definition.name,
			description: definition.description,
			parameters: CuaBatchSchema,
			async execute(_toolCallId: string, params: unknown): Promise<AgentToolResult<BatchDetails>> {
				const result = await executeBatchTool(translator, asBatchInput(params));
				if (result.isError) throw Object.assign(new Error(result.details.statusText), result);
				return { content: result.content, details: result.details };
			},
		};
		return tool;
	}
	if (definition.name === CUA_NAVIGATION_TOOL_NAME) {
		const tool: NavigationTool = {
			name: definition.name,
			label: definition.name,
			description: definition.description,
			parameters: CuaNavigationSchema,
			async execute(_toolCallId: string, params: unknown): Promise<AgentToolResult<NavigationDetails>> {
				const result = await executeNavigationTool(translator, asNavigationInput(params));
				if (result.isError) throw Object.assign(new Error(result.details.statusText), result);
				return { content: result.content, details: result.details };
			},
		};
		return tool;
	}
	throw new Error(
		`unsupported CUA computer tool definition: ${definition.name}; supported names: ${SUPPORTED_CUA_EXECUTOR_TOOL_NAMES.join(", ")}`,
	);
}

async function executeBatchTool(translator: InternalComputerTranslator, params: CuaBatchInput): Promise<{
	content: ToolContent;
	details: BatchDetails;
	isError: boolean;
}> {
	const content: ToolContent = [];
	const readResults: BatchDetails["readResults"] = [];
	let statusText = "Actions executed successfully.";
	let error: Error | undefined;
	try {
		const result = await translator.executeBatch(params.actions as unknown as Array<Record<string, unknown>>);
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

async function executeNavigationTool(translator: InternalComputerTranslator, params: CuaNavigationInput): Promise<{
	content: ToolContent;
	details: NavigationDetails;
	isError: boolean;
}> {
	const action = params.action;
	const content: ToolContent = [];
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

function asBatchInput(value: unknown): CuaBatchInput {
	if (
		value &&
		typeof value === "object" &&
		Array.isArray((value as { actions?: unknown }).actions)
	) {
		return value as CuaBatchInput;
	}
	throw new Error("invalid batch_computer_actions parameters");
}

function asNavigationInput(value: unknown): CuaNavigationInput {
	if (
		value &&
		typeof value === "object" &&
		typeof (value as { action?: unknown }).action === "string"
	) {
		return value as CuaNavigationInput;
	}
	throw new Error("invalid computer_use_extra parameters");
}
