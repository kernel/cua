export const YUTORI_COORDINATE_SCALE = 1000;

export interface YutoriScreenSize {
	width: number;
	height: number;
}

export const DEFAULT_YUTORI_SCREEN_SIZE: YutoriScreenSize = {
	width: 1920,
	height: 1080,
};

export enum YutoriAction {
	LEFT_CLICK = "left_click",
	DOUBLE_CLICK = "double_click",
	TRIPLE_CLICK = "triple_click",
	RIGHT_CLICK = "right_click",
	SCROLL = "scroll",
	TYPE = "type",
	KEY_PRESS = "key_press",
	HOVER = "hover",
	DRAG = "drag",
	WAIT = "wait",
	REFRESH = "refresh",
	GO_BACK = "go_back",
	GOTO_URL = "goto_url",
}

export const YUTORI_ACTION_TYPES = Object.values(YutoriAction);

export type YutoriActionType = `${YutoriAction}`;
export type YutoriScrollDirection = "up" | "down" | "left" | "right";

export const YUTORI_MODEL_IDS = [
	"n1-latest",
	"n1-20260203",
	"n1.5-latest",
	"n1.5-20260428",
] as const;

export type YutoriModelId = (typeof YUTORI_MODEL_IDS)[number];
