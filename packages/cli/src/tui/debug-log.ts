import {
	appendFileSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { stderr } from "node:process";

const PI_RENDER_DIR = "/tmp/tui";
const PI_REDRAW_LOG = path.join(os.homedir(), ".pi", "agent", "pi-debug.log");

interface EnvSnapshot {
	PI_TUI_DEBUG?: string;
	PI_DEBUG_REDRAW?: string;
	PI_TUI_WRITE_LOG?: string;
}

export interface TuiDebugLog {
	readonly dir: string;
	log(event: string, data?: Record<string, unknown>): void;
	close(data?: Record<string, unknown>): void;
}

export function openTuiDebugLog(): TuiDebugLog {
	const stamp = new Date().toISOString().replaceAll(":", "-");
	const dir = path.join(os.tmpdir(), `cua-tui-debug-${stamp}-${process.pid}`);
	const piRendersDir = path.join(dir, "pi-renders");
	const terminalWriteLog = path.join(dir, "terminal-output.log");
	const eventsPath = path.join(dir, "events.jsonl");

	mkdirSync(piRendersDir, { recursive: true });
	writeFileSync(
		path.join(dir, "README.txt"),
		[
			"cua --debug-tui artifacts",
			"",
			"events.jsonl         app-level event timeline",
			"terminal-output.log  raw terminal bytes written by pi-tui",
			"pi-debug-redraw.log  full redraw reasons from PI_DEBUG_REDRAW",
			"pi-renders/          per-render pi-tui debug snapshots",
			"",
			"These artifacts are meant to be captured during a manual TUI repro.",
		].join("\n"),
	);

	const previousEnv: EnvSnapshot = {
		PI_TUI_DEBUG: process.env.PI_TUI_DEBUG,
		PI_DEBUG_REDRAW: process.env.PI_DEBUG_REDRAW,
		PI_TUI_WRITE_LOG: process.env.PI_TUI_WRITE_LOG,
	};

	const initialPiRenderFiles = snapshotFiles(PI_RENDER_DIR);
	const redrawLogSize = fileSize(PI_REDRAW_LOG);

	process.env.PI_TUI_DEBUG = "1";
	process.env.PI_DEBUG_REDRAW = "1";
	process.env.PI_TUI_WRITE_LOG = terminalWriteLog;

	stderr.write(`[cua] TUI debug logs: ${dir}\n`);

	const writeEvent = (event: string, data: Record<string, unknown> = {}): void => {
		appendFileSync(
			eventsPath,
			JSON.stringify({
				ts: new Date().toISOString(),
				pid: process.pid,
				event,
				...data,
			}) + "\n",
		);
	};

	writeEvent("debug_open", { dir });

	let closed = false;

	return {
		dir,
		log(event: string, data: Record<string, unknown> = {}): void {
			writeEvent(event, data);
		},
		close(data: Record<string, unknown> = {}): void {
			if (closed) return;
			closed = true;
			writeEvent("debug_close", data);
			copyNewFiles(PI_RENDER_DIR, initialPiRenderFiles, piRendersDir);
			copyRedrawLogDelta(PI_REDRAW_LOG, redrawLogSize, path.join(dir, "pi-debug-redraw.log"));
			restoreEnv(previousEnv);
		},
	};
}

function snapshotFiles(dir: string): Set<string> {
	if (!existsSync(dir)) return new Set();
	return new Set(readdirSync(dir));
}

function fileSize(file: string): number {
	if (!existsSync(file)) return 0;
	return statSync(file).size;
}

function copyNewFiles(sourceDir: string, before: Set<string>, targetDir: string): void {
	if (!existsSync(sourceDir)) return;
	for (const entry of readdirSync(sourceDir)) {
		if (before.has(entry)) continue;
		copyFileSync(path.join(sourceDir, entry), path.join(targetDir, entry));
	}
}

function copyRedrawLogDelta(sourceFile: string, startSize: number, targetFile: string): void {
	if (!existsSync(sourceFile)) return;
	const content = readFileSync(sourceFile);
	const start = Math.min(startSize, content.length);
	if (start >= content.length) return;
	writeFileSync(targetFile, content.subarray(start));
}

function restoreEnv(previous: EnvSnapshot): void {
	restoreVar("PI_TUI_DEBUG", previous.PI_TUI_DEBUG);
	restoreVar("PI_DEBUG_REDRAW", previous.PI_DEBUG_REDRAW);
	restoreVar("PI_TUI_WRITE_LOG", previous.PI_TUI_WRITE_LOG);
}

function restoreVar(name: keyof EnvSnapshot, value?: string): void {
	if (value === undefined) {
		delete process.env[name];
		return;
	}
	process.env[name] = value;
}
