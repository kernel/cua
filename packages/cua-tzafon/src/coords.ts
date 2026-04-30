import {
	DEFAULT_TZAFON_SCREEN_SIZE,
	TZAFON_COORDINATE_SCALE,
	type TzafonScreenSize,
} from "./official.js";

export function parseTzafonCoord(value: unknown): number {
	if (value == null) return 0;
	let text = String(value);
	if (text.includes(",")) text = text.split(",")[0]!.trim();
	const parsed = Number(text);
	if (!Number.isFinite(parsed)) return 0;
	return Math.trunc(parsed);
}

export function denormalizeX(value: unknown, screen: TzafonScreenSize = DEFAULT_TZAFON_SCREEN_SIZE): number {
	return denormalizeCoord(value, screen.width);
}

export function denormalizeY(value: unknown, screen: TzafonScreenSize = DEFAULT_TZAFON_SCREEN_SIZE): number {
	return denormalizeCoord(value, screen.height);
}

function denormalizeCoord(value: unknown, size: number): number {
	const max = Math.max(0, Math.trunc(size) - 1);
	const coord = parseTzafonCoord(value);
	return Math.max(0, Math.min(Math.trunc((coord * max) / TZAFON_COORDINATE_SCALE), max));
}
