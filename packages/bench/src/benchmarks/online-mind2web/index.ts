import type { Benchmark } from "../../types";
import { gradeWithWebJudge } from "../../judge/webjudge";
import { loadOnlineMind2WebTasks } from "./dataset";

export const onlineMind2Web: Benchmark = {
	id: "online-mind2web",
	description: "300 live web tasks (osunlp/Online-Mind2Web), graded by WebJudge.",
	loadTasks: (opts) => loadOnlineMind2WebTasks(opts),
	buildInstruction(task) {
		return task.startUrl
			? `Go to ${task.startUrl} and then complete the following task:\n${task.instruction}`
			: task.instruction;
	},
	grade: (args) => gradeWithWebJudge(args),
};
