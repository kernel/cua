import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { BenchTask, LoadTasksOptions } from "../../types";

const DATASET_URL =
	"https://huggingface.co/datasets/osunlp/Online-Mind2Web/resolve/main/Online_Mind2Web.json";
const DEFAULT_CACHE = join(homedir(), ".cache", "cua-bench", "online-mind2web", "Online_Mind2Web.json");

interface RawTask {
	task_id?: string;
	confirmed_task?: string;
	task?: string;
	website?: string;
	reference_length?: number;
}

/** Parse the raw dataset JSON into tasks, mapping fields and skipping malformed rows. */
export function parseOnlineMind2WebTasks(raw: string, limit?: number): BenchTask[] {
	const rows = JSON.parse(raw) as RawTask[];
	const tasks: BenchTask[] = [];
	for (const row of rows) {
		const instruction = row.confirmed_task ?? row.task;
		if (!row.task_id || !instruction) continue;
		tasks.push({
			id: row.task_id,
			instruction,
			startUrl: row.website,
			metadata: row.reference_length != null ? { referenceLength: row.reference_length } : undefined,
		});
	}
	return limit != null ? tasks.slice(0, limit) : tasks;
}

/** Load Online-Mind2Web tasks from the on-disk cache, fetching from HuggingFace on a miss. */
export async function loadOnlineMind2WebTasks(opts: LoadTasksOptions = {}): Promise<BenchTask[]> {
	const cacheFile = opts.cacheDir ? join(opts.cacheDir, "Online_Mind2Web.json") : DEFAULT_CACHE;
	const raw = existsSync(cacheFile)
		? await readFile(cacheFile, "utf8")
		: await fetchAndCache(cacheFile, opts.token);
	return parseOnlineMind2WebTasks(raw, opts.limit);
}

async function fetchAndCache(cacheFile: string, token?: string): Promise<string> {
	const t =
		token ??
		process.env.HF_TOKEN ??
		process.env.HUGGINGFACE_TOKEN ??
		process.env.HUGGING_FACE_HUB_TOKEN;
	if (!t) {
		throw new Error(
			"Online-Mind2Web is a gated HF dataset. Accept the terms at https://huggingface.co/datasets/osunlp/Online-Mind2Web and set HF_TOKEN.",
		);
	}
	const res = await fetch(DATASET_URL, { headers: { Authorization: `Bearer ${t}` } });
	if (!res.ok) {
		throw new Error(
			`failed to fetch Online-Mind2Web dataset (${res.status}). Ensure HF_TOKEN has access (gated dataset).`,
		);
	}
	const body = await res.text();
	await mkdir(dirname(cacheFile), { recursive: true });
	await writeFile(cacheFile, body);
	return body;
}
