import type { CuaModelRef } from "@onkernel/cua-ai";
import { runTask } from "./runTask";
import type { Task } from "./types";

const TASK: Task = {
	id: "hn-top-story",
	prompt: "Go to https://news.ycombinator.com and tell me the title of the current top story.",
};

const MODEL: CuaModelRef = "anthropic:claude-opus-4-6";

async function main(): Promise<void> {
	console.log(`[bench] running task "${TASK.id}" on ${MODEL}`);
	const result = await runTask(MODEL, TASK);
	console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
