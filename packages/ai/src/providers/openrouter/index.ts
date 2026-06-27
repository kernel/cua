import {
	computerTools,
	createCuaActionToolExecutors,
	type ComputerToolsOptions,
	type CuaAction,
	type CuaToolExecutorSpec,
} from "../common";
import type { ComputerToolCoordinateSystem, CuaProviderModule } from "../common";

export {
	CUA_ACTION_TYPES as OPENROUTER_CUA_ACTION_TYPES,
	computerTools,
	createCuaActionSchema as createActionSchema,
} from "../common";
export type {
	ComputerToolsOptions,
	CuaAction as OpenRouterAction,
} from "../common";

// OpenRouter exposes the GLM V models through its OpenAI-compatible Chat
// Completions API. The model-specific Z.AI docs describe function calling, but
// not a provider-native browser coordinate system, so CUA uses screenshot pixel
// coordinates with the standard canonical action tools.
export function coordinateSystem(): ComputerToolCoordinateSystem {
	return { type: "pixel" };
}

export const OPENROUTER_COMPUTER_INSTRUCTIONS = `You control a Kernel cloud browser through individual browser tools. Use screenshot pixel coordinates for tool calls, and request screenshots or URL reads when state changes.`;

export function buildOpenRouterSystemPrompt(opts: { suffix?: string } = {}): string {
	return [OPENROUTER_COMPUTER_INSTRUCTIONS, opts.suffix].filter(Boolean).join("\n\n");
}

/** Build OpenRouter execution adapters and normalize GLM tuple-shaped coordinates before browser execution. */
export function computerToolExecutors(options: ComputerToolsOptions = {}): CuaToolExecutorSpec[] {
	return createCuaActionToolExecutors(options.actions).map((executor) => ({
		...executor,
		toActions(args: unknown): CuaAction[] {
			return executor.toActions(args).map(normalizeOpenRouterAction);
		},
	}));
}

/** Normalize OpenRouter GLM-V coordinate arguments into canonical CUA numeric coordinates. */
export function normalizeOpenRouterAction(action: CuaAction): CuaAction {
	switch (action.type) {
		case "click":
		case "double_click":
		case "mouse_down":
		case "mouse_up":
		case "move": {
			const { x, y, ...rest } = action;
			return { ...rest, ...normalizeRequiredPoint(action.type, x, y) };
		}
		case "scroll": {
			const { x, y, ...rest } = action;
			return { ...rest, ...normalizeOptionalPoint(action.type, x, y) };
		}
		case "drag":
			return {
				...action,
				path: action.path.map((point) => normalizeRequiredPoint("drag path", point.x, point.y)),
			};
		default:
			return action;
	}
}

function normalizeRequiredPoint(label: string, xValue: unknown, yValue: unknown): { x: number; y: number } {
	const x = coordinateNumber(xValue, 0);
	const y = coordinateNumber(yValue, 1) ?? coordinateTupleNumber(xValue, 1);
	if (x === undefined || y === undefined) throw new Error(`invalid OpenRouter ${label} coordinates`);
	return { x, y };
}

function normalizeOptionalPoint(label: string, xValue: unknown, yValue: unknown): { x?: number; y?: number } {
	const x = coordinateNumber(xValue, 0);
	const yFromTuple = coordinateTupleNumber(xValue, 1);
	const y = coordinateNumber(yValue, 1) ?? yFromTuple;
	if (xValue !== undefined && x === undefined) throw new Error(`invalid OpenRouter ${label} x coordinate`);
	if ((yValue !== undefined || yFromTuple !== undefined) && y === undefined) throw new Error(`invalid OpenRouter ${label} y coordinate`);
	return {
		...(x !== undefined ? { x } : {}),
		...(y !== undefined ? { y } : {}),
	};
}

function coordinateNumber(value: unknown, index: number): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (Array.isArray(value)) {
		const next = value[index] ?? value[0];
		return typeof next === "number" && Number.isFinite(next) ? next : undefined;
	}
	return undefined;
}

function coordinateTupleNumber(value: unknown, index: number): number | undefined {
	if (!Array.isArray(value)) return undefined;
	const next = value[index];
	return typeof next === "number" && Number.isFinite(next) ? next : undefined;
}

export const providerModule = {
	toolDefinitions: computerTools,
	toolExecutors: computerToolExecutors,
	coordinateSystem,
	buildSystemPrompt: buildOpenRouterSystemPrompt,
} satisfies CuaProviderModule;
