import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const config = require("./ghostty-config.cjs");

export async function ensureGhosttySource() {
	if (existsSync(resolve(config.sourceDir, "build.zig"))) {
		return config.sourceDir;
	}

	mkdirSync(config.downloadDir, { recursive: true });
	mkdirSync(dirname(config.sourceDir), { recursive: true });

	await ensureArchive();
	extractArchive();
	return config.sourceDir;
}

async function ensureArchive() {
	if (existsSync(config.archivePath)) {
		const actual = await sha256File(config.archivePath);
		if (actual === config.upstream.sha256) {
			return;
		}
		rmSync(config.archivePath, { force: true });
	}

	const response = await fetch(config.upstream.archiveUrl);
	if (!response.ok || !response.body) {
		throw new Error(`Unable to download Ghostty archive from ${config.upstream.archiveUrl}: ${response.status} ${response.statusText}`);
	}

	const tempArchivePath = `${config.archivePath}.tmp-${process.pid}`;
	rmSync(tempArchivePath, { force: true });

	try {
		await pipeline(Readable.fromWeb(response.body), createWriteStream(tempArchivePath));
		const actual = await sha256File(tempArchivePath);
		if (actual !== config.upstream.sha256) {
			throw new Error(
				`Ghostty archive sha256 mismatch for ${config.upstream.commit}: expected ${config.upstream.sha256}, got ${actual}`,
			);
		}
		renameSync(tempArchivePath, config.archivePath);
	} catch (error) {
		rmSync(tempArchivePath, { force: true });
		throw error;
	}
}

function extractArchive() {
	const stageDir = `${config.sourceDir}.tmp-${process.pid}`;
	rmSync(stageDir, { recursive: true, force: true });
	rmSync(config.sourceDir, { recursive: true, force: true });
	mkdirSync(stageDir, { recursive: true });

	try {
		run([
			"tar",
			"-xzf",
			config.archivePath,
			"-C",
			stageDir,
			"--strip-components=1",
		]);
		if (!existsSync(resolve(stageDir, "build.zig"))) {
			throw new Error(`Ghostty archive did not extract a valid source tree into ${stageDir}`);
		}
		renameSync(stageDir, config.sourceDir);
	} catch (error) {
		rmSync(stageDir, { recursive: true, force: true });
		throw error;
	}
}

async function sha256File(path) {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(path)) {
		hash.update(chunk);
	}
	return hash.digest("hex");
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
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) {
	await ensureGhosttySource();
}
