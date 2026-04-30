import { YUTORI_COORDINATE_SCALE, type YutoriScreenSize } from "./official.js";

export function denormalizeX(x: number, screen: YutoriScreenSize): number {
	return Math.round((x / YUTORI_COORDINATE_SCALE) * screen.width);
}

export function denormalizeY(y: number, screen: YutoriScreenSize): number {
	return Math.round((y / YUTORI_COORDINATE_SCALE) * screen.height);
}
