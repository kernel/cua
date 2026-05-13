import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import { delimiter, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { ensureGhosttySource } from "./ensure-ghostty.mjs";

const require = createRequire(import.meta.url);
const config = require("./ghostty-config.cjs");
const localZig = resolve(config.workspaceRoot, ".dev/tools/zig-x86_64-linux-0.15.2/zig");
const requiredVersion = config.upstream.zigVersion;

const ghosttyRoot = await ensureGhosttySource();

const zig = resolveZigBinary();
const runEnv = withZigPath(zig);
const version = run([zig, "version"], { env: runEnv }).trim();
if (version !== requiredVersion) {
	throw new Error(
		`Ghostty requires Zig ${requiredVersion}, but ${zig} reported ${version}. ` +
			`Set PTYWRIGHT_ZIG to a compatible Zig binary or cache one under .dev/tools.`,
	);
}

mkdirSync(config.zigCacheDir, { recursive: true });
mkdirSync(config.zigGlobalCacheDir, { recursive: true });

run([
	zig,
	"build",
	"-Demit-lib-vt=true",
	"--cache-dir",
	config.zigCacheDir,
	"--global-cache-dir",
	config.zigGlobalCacheDir,
], {
	cwd: ghosttyRoot,
	env: runEnv,
});

function resolveZigBinary() {
	if (process.env.PTYWRIGHT_ZIG) {
		return process.env.PTYWRIGHT_ZIG;
	}
	if (process.platform === "linux" && process.arch === "x64" && existsSync(localZig)) {
		return localZig;
	}
	return "zig";
}

function withZigPath(zigBinary) {
	const zigDir = dirname(zigBinary);
	const currentPath = process.env.PATH ?? "";
	const pathEntries = currentPath.split(delimiter).filter((entry) => entry.length > 0);
	if (!pathEntries.includes(zigDir)) {
		pathEntries.unshift(zigDir);
	}
	return {
		...process.env,
		PATH: pathEntries.join(delimiter),
	};
}

function run(command, options = {}) {
	const result = spawnSync(command[0], command.slice(1), {
		stdio: "pipe",
		encoding: "utf8",
		...options,
	});
	if (result.status !== 0) {
		throw new Error(
			[
				`Command failed: ${command.join(" ")}`,
				result.stdout?.trim(),
				result.stderr?.trim(),
			]
				.filter(Boolean)
				.join("\n"),
		);
	}
	return result.stdout ?? "";
}
