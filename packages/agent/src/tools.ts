import type Kernel from "@onkernel/sdk";
import type { ImageContent, TextContent, Tool } from "@earendil-works/pi-ai";
import {
	CUA_NAVIGATION_TOOL_NAME,
	createCuaNavigationToolDefinition,
	type ComputerToolCoordinateSystem,
	type CuaBatchInput,
	type CuaNavigationInput,
	type CuaScreenshotSpec,
	type CuaToolExecutorSpec,
	type TSchema,
} from "@onkernel/cua-ai";
import { InternalComputerTranslator, type KernelBrowser } from "./translator/translator";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";

export interface ComputerToolOptions {
	browser: KernelBrowser;
	client: Kernel;
	toolExecutors: CuaToolExecutorSpec[];
	coordinateSystem?: ComputerToolCoordinateSystem;
	screenshot?: CuaScreenshotSpec;
	computerUseExtra?: boolean;
}

type ToolContent = Array<TextContent | ImageContent>;

export interface BatchDetails {
	statusText: string;
	readResults: Array<{ type: "url"; url: string } | { type: "screenshot"; bytes: number } | { type: "cursor_position"; x: number; y: number }>;
}

export interface NavigationDetails {
	action: string;
	statusText: string;
	url?: string;
}

type BatchTool = AgentTool<TSchema, BatchDetails>;
type NavigationTool = AgentTool<TSchema, NavigationDetails>;
type ActionTool = AgentTool<TSchema, BatchDetails>;
export type CuaExecutorTool = BatchTool | NavigationTool | ActionTool;
type NavigationExecutorSpec = { kind: "navigation"; definition: Tool };
type ComputerExecutorSpec = CuaToolExecutorSpec | NavigationExecutorSpec;

export function createCuaComputerTools(args: ComputerToolOptions): CuaExecutorTool[] {
	return buildCuaComputerTools(args, new InternalComputerTranslator(args));
}

/** Build executor tools against an existing translator (internal; not part of the package surface). */
export function buildCuaComputerTools(
	args: Pick<ComputerToolOptions, "toolExecutors" | "computerUseExtra">,
	translator: InternalComputerTranslator,
): CuaExecutorTool[] {
	return withNavigationTool(args).map((executor) => createExecutorTool(executor, translator));
}

function withNavigationTool(args: Pick<ComputerToolOptions, "toolExecutors" | "computerUseExtra">): ComputerExecutorSpec[] {
	const executors: ComputerExecutorSpec[] = [...args.toolExecutors];
	const existing = new Set(executors.map((executor) => executor.definition.name));
	if (args.computerUseExtra && !existing.has(CUA_NAVIGATION_TOOL_NAME)) {
		const definition = createCuaNavigationToolDefinition();
		executors.push({ kind: "navigation", definition });
	}
	return executors;
}

function createExecutorTool(executor: ComputerExecutorSpec, translator: InternalComputerTranslator): CuaExecutorTool {
	const { definition } = executor;
	if (isNavigationExecutor(executor)) {
		const tool: NavigationTool = {
			name: definition.name,
			label: definition.name,
			description: definition.description,
			parameters: definition.parameters,
			async execute(_toolCallId: string, params: unknown): Promise<AgentToolResult<NavigationDetails>> {
				return executeNavigationTool(translator, asNavigationInput(params));
			},
		};
		return tool;
	}
	const tool: ActionTool = {
		name: definition.name,
		label: definition.name,
		description: definition.description,
		parameters: definition.parameters,
		executionMode: "sequential",
		async execute(_toolCallId: string, params: unknown): Promise<AgentToolResult<BatchDetails>> {
			return executeBatchTool(translator, { actions: executor.toActions(params) });
		},
	};
	return tool;
}

function isNavigationExecutor(executor: ComputerExecutorSpec): executor is NavigationExecutorSpec {
	return "kind" in executor && executor.kind === "navigation";
}

async function executeBatchTool(translator: InternalComputerTranslator, params: CuaBatchInput): Promise<AgentToolResult<BatchDetails>> {
	const content: ToolContent = [];
	const readResults: BatchDetails["readResults"] = [];
	try {
		const result = await translator.executeBatch(params.actions);
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
		throw new Error(`Actions failed: ${errorMessage(err)}`, { cause: err });
	}
	return { content, details: { statusText: "Actions executed successfully.", readResults } };
}

async function executeNavigationTool(translator: InternalComputerTranslator, params: CuaNavigationInput): Promise<AgentToolResult<NavigationDetails>> {
	const action = params.action;
	try {
		let statusText = `${action} executed successfully.`;
		let url: string | undefined;
		if (action === "url") {
			url = await translator.currentUrl();
			statusText = `Current URL: ${url}`;
		} else if (action === "goto") {
			await translator.executeBatch([{ type: "goto", url: params.url ?? "" }]);
		} else {
			await translator.executeBatch([{ type: action }]);
		}
		const screenshot = await translator.screenshot();
		return {
			content: [
				{ type: "text", text: statusText },
				{ type: "image", data: screenshot.data.toString("base64"), mimeType: screenshot.mimeType },
			],
			details: { action, statusText, ...(url ? { url } : {}) },
		};
	} catch (err) {
		throw new Error(`${action} failed: ${errorMessage(err)}`, { cause: err });
	}
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
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
