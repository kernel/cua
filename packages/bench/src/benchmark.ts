import type { CuaModelRef } from "@onkernel/cua-ai";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createKernelClient, DEFAULT_BROWSER_SETTINGS } from "./browser";
import { runPool } from "./pool";
import { modelSlug, runOne } from "./runOne";
import { loadTasks } from "./tasks";

const DEFAULT_MODELS: CuaModelRef[] = [
	"anthropic:claude-opus-4-6",
	"openai:gpt-5.5",
	"google:gemini-3-flash-preview",
];

/**
 * How many times a task may error before it's treated as a permanent failure
 * for that model and stops being retried. Some tasks fail deterministically
 * (e.g. a model whose trajectory grows past the provider's max request size),
 * so without a cap a resumable run would retry them forever.
 */
const MAX_ATTEMPTS = 3;

interface Options {
	tasksPath: string;
	outDir: string;
	limit?: number;
	concurrency: number;
	models: CuaModelRef[];
}

function parseArgs(argv: string[]): Options {
	const opts: Options = {
		tasksPath: "tasks/online-mind2web-test.json",
		outDir: "results",
		concurrency: 5,
		models: DEFAULT_MODELS,
	};
	for (let i = 0; i < argv.length; i++) {
		const value = () => argv[++i] ?? "";
		switch (argv[i]) {
			case "--tasks":
				opts.tasksPath = value();
				break;
			case "--out":
				opts.outDir = value();
				break;
			case "--limit":
				opts.limit = Number(value());
				break;
			case "--concurrency":
				opts.concurrency = Number(value());
				break;
			case "--models":
				opts.models = value().split(",").map((s) => s.trim()) as CuaModelRef[];
				break;
		}
	}
	return opts;
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function readAttempts(taskDir: string): Promise<number> {
	try {
		return Number.parseInt(await readFile(join(taskDir, "attempts"), "utf8"), 10) || 0;
	} catch {
		return 0;
	}
}

async function recordAttempt(taskDir: string, count: number): Promise<void> {
	await mkdir(taskDir, { recursive: true });
	await writeFile(join(taskDir, "attempts"), String(count));
}

async function main(): Promise<void> {
	const opts = parseArgs(process.argv.slice(2));
	const client = createKernelClient();
	const tasks = await loadTasks(opts.tasksPath, opts.limit);
	console.log(`[bench] ${tasks.length} tasks × ${opts.models.length} models, concurrency ${opts.concurrency}`);

	for (const model of opts.models) {
		const slug = modelSlug(model);
		console.log(`[bench] === ${model} ===`);
		let done = 0;
		let failed = 0;
		let skipped = 0;
		let exhausted = 0;
		await runPool(tasks, opts.concurrency, async (task) => {
			const taskDir = join(opts.outDir, slug, task.task_id);
			if (await exists(join(taskDir, "result.json"))) {
				skipped++;
				return;
			}
			const attempts = await readAttempts(taskDir);
			if (attempts >= MAX_ATTEMPTS) {
				exhausted++;
				return;
			}
			try {
				const m = await runOne(client, model, task, DEFAULT_BROWSER_SETTINGS, taskDir);
				done++;
				console.log(`[bench] ${slug} ${task.task_id} ok steps=${m.steps} ${(m.wallClockMs / 1000).toFixed(1)}s`);
			} catch (err) {
				await recordAttempt(taskDir, attempts + 1);
				failed++;
				console.error(`[bench] ${slug} ${task.task_id} FAILED (attempt ${attempts + 1}/${MAX_ATTEMPTS}): ${(err as Error).message}`);
			}
		});
		console.log(`[bench] ${slug}: done=${done} skipped=${skipped} failed=${failed} exhausted=${exhausted}`);
	}

	console.log(`[bench] complete — results in ${opts.outDir}/`);
	console.log("[bench] next: score with scripts/run-webjudge.sh, then aggregate with src/aggregate.ts");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
