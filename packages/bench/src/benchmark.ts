import type { CuaModelRef } from "@onkernel/cua-ai";
import { access } from "node:fs/promises";
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
		await runPool(tasks, opts.concurrency, async (task) => {
			const taskDir = join(opts.outDir, slug, task.task_id);
			if (await exists(join(taskDir, "result.json"))) {
				skipped++;
				return;
			}
			try {
				const m = await runOne(client, model, task, DEFAULT_BROWSER_SETTINGS, taskDir);
				done++;
				console.log(`[bench] ${slug} ${task.task_id} ok steps=${m.steps} ${(m.wallClockMs / 1000).toFixed(1)}s`);
			} catch (err) {
				failed++;
				console.error(`[bench] ${slug} ${task.task_id} FAILED: ${(err as Error).message}`);
			}
		});
		console.log(`[bench] ${slug}: done=${done} skipped=${skipped} failed=${failed}`);
	}

	console.log(`[bench] complete — results in ${opts.outDir}/`);
	console.log("[bench] next: score with scripts/run-webjudge.sh, then aggregate with src/aggregate.ts");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
