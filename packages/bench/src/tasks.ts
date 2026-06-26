import { readFile } from "node:fs/promises";
import type { Om2wTask } from "./types";

/**
 * Load Online-Mind2Web tasks from a local JSON file produced by
 * `scripts/fetch-tasks.py` (the dataset is gated, so it's fetched with the
 * official `datasets` loader rather than over HTTP).
 */
export async function loadTasks(path: string, limit?: number): Promise<Om2wTask[]> {
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch {
		throw new Error(`task file not found at ${path} — generate it with: python scripts/fetch-tasks.py --out ${path}`);
	}
	const tasks = JSON.parse(raw) as Om2wTask[];
	return typeof limit === "number" ? tasks.slice(0, limit) : tasks;
}
