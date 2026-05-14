import type Kernel from "@onkernel/sdk";
import type { ImageContent, TextContent, Tool } from "@earendil-works/pi-ai";
import type { TSchema } from "typebox";
import {
	CUA_ACTION_TYPES,
	CUA_BATCH_TOOL_NAME,
	CUA_NAVIGATION_TOOL_NAME,
	createCuaBatchToolDefinition,
	createCuaNavigationToolDefinition,
	type ComputerToolCoordinateSystem,
	type CuaAction,
	type CuaActionType,
	type CuaBatchInput,
	type CuaNavigationInput,
	type CuaScreenshotSpec,
} from "@onkernel/cua-ai";
import { InternalComputerTranslator, type KernelBrowser } from "./translator/translator";
import type { AgentTool, AgentToolResult } from "./vendor/pi-agent-core/index";

export interface ComputerToolOptions {
	browser: KernelBrowser;
	client: Kernel;
	toolDefinitions: Tool[];
	coordinateSystem?: ComputerToolCoordinateSystem;
	screenshot?: CuaScreenshotSpec;
	batchTool?: boolean;
	computerUseExtra?: boolean;
}

const CUA_ACTION_TOOL_NAMES = new Set<string>(CUA_ACTION_TYPES);
export const SUPPORTED_CUA_EXECUTOR_TOOL_NAMES = [
	CUA_BATCH_TOOL_NAME,
	CUA_NAVIGATION_TOOL_NAME,
	...CUA_ACTION_TYPES,
] as const;
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

type BatchTool = AgentTool<TSchema, BatchDetails>;
type NavigationTool = AgentTool<TSchema, NavigationDetails>;
type ActionTool = AgentTool<TSchema, BatchDetails>;
export type CuaExecutorTool = BatchTool | NavigationTool | ActionTool;

export function createCuaComputerTools(args: ComputerToolOptions): CuaExecutorTool[] {
	const translator = new InternalComputerTranslator(args);
	return withSynthesizedTools(args).map((definition) => createExecutorTool(definition, translator));
}

function withSynthesizedTools(args: ComputerToolOptions): Tool[] {
	const definitions = [...args.toolDefinitions];
	const existing = new Set(definitions.map((definition) => definition.name));
	const actionTypes = definitions
		.map((definition) => definition.name)
		.filter((name): name is CuaActionType => CUA_ACTION_TOOL_NAMES.has(name));
	if (args.batchTool && actionTypes.length > 0 && !existing.has(CUA_BATCH_TOOL_NAME)) {
		definitions.push(createCuaBatchToolDefinition(actionTypes));
	}
	if (args.computerUseExtra && !existing.has(CUA_NAVIGATION_TOOL_NAME)) {
		definitions.push(createCuaNavigationToolDefinition());
	}
	return definitions;
}

function createExecutorTool(definition: Tool, translator: InternalComputerTranslator): CuaExecutorTool {
	if (definition.name === CUA_BATCH_TOOL_NAME) {
		const tool: BatchTool = {
			name: definition.name,
			label: definition.name,
			description: definition.description,
			parameters: definition.parameters,
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
			parameters: definition.parameters,
			async execute(_toolCallId: string, params: unknown): Promise<AgentToolResult<NavigationDetails>> {
				const result = await executeNavigationTool(translator, asNavigationInput(params));
				if (result.isError) throw Object.assign(new Error(result.details.statusText), result);
				return { content: result.content, details: result.details };
			},
		};
		return tool;
	}
	if (CUA_ACTION_TOOL_NAMES.has(definition.name)) {
		const actionType = definition.name as CuaActionType;
		const tool: ActionTool = {
			name: definition.name,
			label: definition.name,
			description: definition.description,
			parameters: definition.parameters,
			executionMode: "sequential",
			async execute(_toolCallId: string, params: unknown): Promise<AgentToolResult<BatchDetails>> {
				const action = { ...(params && typeof params === "object" ? params : {}), type: actionType } as CuaAction;
				const result = await executeBatchTool(translator, { actions: [action] });
				if (result.isError) throw Object.assign(new Error(result.details.statusText), result);
				return { content: result.content, details: result.details };
			},
		};
		return tool;
	}
	throw new Error(
		`unsupported CUA computer tool definition: ${definition.name}`,
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
				readResults.push({ type: "screenshot", bytes: read.data.length });
				content.push({ type: "image", data: read.data.toString("base64"), mimeType: read.mimeType });
			}
		}
		if (content.length === 0) {
			const screenshot = await translator.screenshot();
			readResults.push({ type: "screenshot", bytes: screenshot.data.length });
			content.push({ type: "image", data: screenshot.data.toString("base64"), mimeType: screenshot.mimeType });
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
		const screenshot = await translator.screenshot();
		content.push({ type: "image", data: screenshot.data.toString("base64"), mimeType: screenshot.mimeType });
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
