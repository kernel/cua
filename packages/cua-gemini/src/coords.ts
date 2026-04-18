import { GEMINI_COORDINATE_SCALE, type GeminiScreenSize } from "./official.js";

/** Convert Gemini's 0–1000 normalized X to pixels for the given screen. */
export function denormalizeX(x: number, screen: GeminiScreenSize): number {
	return Math.round((x / GEMINI_COORDINATE_SCALE) * screen.width);
}

/** Convert Gemini's 0–1000 normalized Y to pixels for the given screen. */
export function denormalizeY(y: number, screen: GeminiScreenSize): number {
	return Math.round((y / GEMINI_COORDINATE_SCALE) * screen.height);
}
