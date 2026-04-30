export const TZAFON_DEFAULT_MODEL = "tzafon.northstar-cua-fast";

export const TZAFON_COORDINATE_SCALE = 999;

export interface TzafonScreenSize {
	width: number;
	height: number;
}

export const DEFAULT_TZAFON_SCREEN_SIZE: TzafonScreenSize = {
	width: 1920,
	height: 1080,
};

export enum TzafonAction {
	CLICK = "click",
	DOUBLE_CLICK = "double_click",
	POINT_AND_TYPE = "point_and_type",
	KEY = "key",
	SCROLL = "scroll",
	DRAG = "drag",
	DONE = "done",
}

export const TZAFON_ACTIONS = [
	TzafonAction.CLICK,
	TzafonAction.DOUBLE_CLICK,
	TzafonAction.POINT_AND_TYPE,
	TzafonAction.KEY,
	TzafonAction.SCROLL,
	TzafonAction.DRAG,
	TzafonAction.DONE,
] as const;

export type TzafonActionName = (typeof TZAFON_ACTIONS)[number];
