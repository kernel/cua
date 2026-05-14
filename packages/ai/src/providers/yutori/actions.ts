import {
	CUA_ACTION_TYPES,
	CUA_BATCH_TOOL_NAME,
	CUA_NAVIGATION_TOOL_NAME,
	type CuaAction,
	type CuaActionType,
} from "../common";

export const YUTORI_N15_CORE_TOOL_SET = "browser_tools_core-20260403";
export const YUTORI_N15_EXPANDED_TOOL_SET = "browser_tools_expanded-20260403";

export const YUTORI_N15_EXPANDED_ACTION_TYPES = [
	"extract_elements",
	"find",
	"set_element_value",
	"execute_js",
] as const;

export const YUTORI_N1_ACTION_TYPES = [
	"left_click",
	"double_click",
	"right_click",
	"triple_click",
	"type",
	"key_press",
	"scroll",
	"hover",
	"drag",
	"goto_url",
	"go_back",
	"refresh",
	"wait",
] as const;

export const YUTORI_N15_CORE_ACTION_TYPES = [
	"left_click",
	"double_click",
	"triple_click",
	"middle_click",
	"right_click",
	"mouse_move",
	"mouse_down",
	"mouse_up",
	"drag",
	"scroll",
	"type",
	"key_press",
	"hold_key",
	"goto_url",
	"go_back",
	"go_forward",
	"refresh",
	"wait",
] as const;

export const YUTORI_N15_ACTION_TYPES = [
	...YUTORI_N15_CORE_ACTION_TYPES,
	...YUTORI_N15_EXPANDED_ACTION_TYPES,
] as const;

export type YutoriN1ActionType = (typeof YUTORI_N1_ACTION_TYPES)[number];
export type YutoriN15CoreActionType = (typeof YUTORI_N15_CORE_ACTION_TYPES)[number];
export type YutoriN15ExpandedActionType = (typeof YUTORI_N15_EXPANDED_ACTION_TYPES)[number];
export type YutoriNativeActionType = YutoriN1ActionType | YutoriN15CoreActionType | YutoriN15ExpandedActionType;

const YUTORI_NATIVE_ACTION_NAMES = new Set<string>([
	...YUTORI_N1_ACTION_TYPES,
	...YUTORI_N15_ACTION_TYPES,
]);

const DEFAULT_SCROLL_AMOUNT = 3;
const SCROLL_AMOUNT_PER_NOTCH = 120;
const DEFAULT_WAIT_MS = 2000;
const NAVIGATION_WAIT_MS = 1500;
const GOTO_WAIT_MS = 2000;

const MODIFIER_MAP: Record<string, string> = {
	alt: "alt",
	command: "super",
	control: "ctrl",
	ctrl: "ctrl",
	cmd: "super",
	meta: "super",
	shift: "shift",
	super: "super",
};

export function createComputerToolDefinitions(_options?: unknown): [] {
	return [];
}

export function yutoriToolSetForModel(modelId: string): typeof YUTORI_N15_CORE_TOOL_SET | undefined {
	return modelId.startsWith("n1.5") ? YUTORI_N15_CORE_TOOL_SET : undefined;
}

export function yutoriNativeActionsForModel(modelId: string): readonly YutoriNativeActionType[] {
	return modelId.startsWith("n1.5") ? YUTORI_N15_CORE_ACTION_TYPES : YUTORI_N1_ACTION_TYPES;
}

export function isYutoriNativeActionName(name: string): boolean {
	return YUTORI_NATIVE_ACTION_NAMES.has(name);
}

export function isCuaDefaultToolName(name: string): boolean {
	return (
		name === CUA_BATCH_TOOL_NAME ||
		name === CUA_NAVIGATION_TOOL_NAME ||
		(CUA_ACTION_TYPES as readonly string[]).includes(name)
	);
}

export function toCanonicalActions(name: string, args: Record<string, unknown>): CuaAction[] | undefined {
	const coords = readPoint(args.coordinates);
	switch (name) {
		case "left_click":
			return coords ? [{ type: "click", x: coords.x, y: coords.y, ...holdKeys(args.modifier) }] : undefined;
		case "right_click":
			return coords ? [{ type: "click", x: coords.x, y: coords.y, button: "right", ...holdKeys(args.modifier) }] : undefined;
		case "middle_click":
			return coords ? [{ type: "click", x: coords.x, y: coords.y, button: "middle", ...holdKeys(args.modifier) }] : undefined;
		case "double_click":
			return coords ? [{ type: "double_click", x: coords.x, y: coords.y, ...holdKeys(args.modifier) }] : undefined;
		case "triple_click":
			return coords
				? [
						{ type: "double_click", x: coords.x, y: coords.y, ...holdKeys(args.modifier) },
						{ type: "click", x: coords.x, y: coords.y, ...holdKeys(args.modifier) },
					]
				: undefined;
		case "mouse_move":
		case "hover":
			return coords ? [{ type: "move", x: coords.x, y: coords.y }] : undefined;
		case "mouse_down":
			return coords ? [{ type: "mouse_down", x: coords.x, y: coords.y, ...holdKeys(args.modifier) }] : undefined;
		case "mouse_up":
			return coords ? [{ type: "mouse_up", x: coords.x, y: coords.y, ...holdKeys(args.modifier) }] : undefined;
		case "drag": {
			const start = readPoint(args.start_coordinates);
			return start && coords ? [{ type: "drag", path: [start, coords], button: "left" }] : undefined;
		}
		case "scroll":
			return toScrollAction(args, coords);
		case "type":
			return toTypeActions(args);
		case "key_press":
			return toKeypressAction(args);
		case "hold_key":
			return toHoldKeyAction(args);
		case "goto_url": {
			const url = typeof args.url === "string" ? args.url : undefined;
			return url ? [{ type: "goto", url }, { type: "wait", ms: GOTO_WAIT_MS }] : undefined;
		}
		case "go_back":
			return [{ type: "back" }, { type: "wait", ms: NAVIGATION_WAIT_MS }];
		case "go_forward":
			return [{ type: "forward" }, { type: "wait", ms: NAVIGATION_WAIT_MS }];
		case "refresh":
			return [{ type: "keypress", keys: ["F5"] }, { type: "wait", ms: DEFAULT_WAIT_MS }];
		case "wait":
			return [{ type: "wait", ms: secondsToMs(args.duration, DEFAULT_WAIT_MS) }];
		default:
			return undefined;
	}
}

export function canonicalToolCallName(action: CuaAction): CuaActionType {
	return action.type;
}

export function canonicalToolCallArguments(action: CuaAction): Record<string, unknown> {
	const { type: _type, ...args } = action as CuaAction & Record<string, unknown>;
	return args;
}

function readPoint(value: unknown): { x: number; y: number } | undefined {
	if (!Array.isArray(value) || value.length < 2) return undefined;
	const x = Number(value[0]);
	const y = Number(value[1]);
	if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
	return { x, y };
}

function toScrollAction(args: Record<string, unknown>, coords: { x: number; y: number } | undefined): CuaAction[] | undefined {
	if (!coords) return undefined;
	const direction = typeof args.direction === "string" ? args.direction : "down";
	const amount = typeof args.amount === "number" ? args.amount : DEFAULT_SCROLL_AMOUNT;
	const ticks = Math.max(1, Math.trunc(amount)) * SCROLL_AMOUNT_PER_NOTCH;
	const scroll_x = direction === "left" ? -ticks : direction === "right" ? ticks : 0;
	const scroll_y = direction === "up" ? -ticks : direction === "down" ? ticks : 0;
	return [{ type: "scroll", x: coords.x, y: coords.y, scroll_x, scroll_y, ...holdKeys(args.modifier) }];
}

function toTypeActions(args: Record<string, unknown>): CuaAction[] | undefined {
	const text = typeof args.text === "string" ? args.text : undefined;
	if (text === undefined) return undefined;
	const actions: CuaAction[] = [];
	if (args.clear_before_typing === true) {
		actions.push({ type: "keypress", keys: ["Control", "a"] }, { type: "keypress", keys: ["Backspace"] });
	}
	actions.push({ type: "type", text });
	if (args.press_enter_after === true) actions.push({ type: "keypress", keys: ["Enter"] });
	return actions;
}

function toKeypressAction(args: Record<string, unknown>): CuaAction[] | undefined {
	const keys = readKeys(args.key_comb ?? args.key);
	return keys.length > 0 ? [{ type: "keypress", keys }] : undefined;
}

function toHoldKeyAction(args: Record<string, unknown>): CuaAction[] | undefined {
	const keys = readKeys(args.key_comb ?? args.key);
	return keys.length > 0 ? [{ type: "keypress", keys, duration: secondsToMs(args.duration, 1000) }] : undefined;
}

function readKeys(value: unknown): string[] {
	if (typeof value !== "string") return [];
	return value
		.split("+")
		.map((part) => part.trim())
		.filter(Boolean);
}

function holdKeys(value: unknown): { hold_keys?: string[] } {
	if (typeof value !== "string") return {};
	const key = MODIFIER_MAP[value.trim().toLowerCase()];
	return key ? { hold_keys: [key] } : {};
}

function secondsToMs(value: unknown, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
	return Math.round(value * 1000);
}
