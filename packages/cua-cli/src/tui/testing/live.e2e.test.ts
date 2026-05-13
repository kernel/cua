import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { KeyCtrlC, spawnSession } from "@onkernel/ptywright";

const LIVE = process.env.CUA_CLI_E2E_LIVE === "1";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const KERNEL_API_KEY = process.env.KERNEL_API_KEY;
const SHOULD_RUN = LIVE && !!OPENAI_API_KEY && !!KERNEL_API_KEY;

test(
	"live TUI e2e: openai model executes tool call and renders assistant output",
	{ skip: !SHOULD_RUN, timeout: 240_000 },
	async (t) => {
		const xdgConfigHome = await writeLiveConfig();
		t.after(async () => {
			await rm(xdgConfigHome, { recursive: true, force: true });
		});

		const session = spawnLiveSession(xdgConfigHome);
		t.after(() => {
			session.close();
		});

		const expectedOutput = "LIVE_UI_TOOL_PASS_7b21";
		const expectedOutputBase64 = Buffer.from(expectedOutput, "utf8").toString("base64");
		const prompt = [
			"Call batch_computer_actions exactly once.",
			'Pass this exact arguments JSON: {"actions":[{"type":"screenshot"}]}',
			`Then decode this base64 string and reply with only the decoded text: ${expectedOutputBase64}`,
			"Do not include any additional words.",
		].join("\n");

		await session.waitForVisible("openai/gpt-5.5", { timeoutMs: 30_000 });
		session.line(prompt);

		await session.waitForVisible("batch_computer_actions", { timeoutMs: 120_000 });
		await session.waitForVisible(expectedOutput, { timeoutMs: 120_000 });
		await session.waitForStable(1_000, { timeoutMs: 20_000 });

		const snapshot = session.snapshot();
		assert.match(snapshot.visible, /assistant[\s\S]*LIVE_UI_TOOL_PASS_7b21/);
		assert.doesNotMatch(snapshot.visible, /tool.*error/i);

		await exitSession(session);
	},
);

function spawnLiveSession(xdgConfigHome: string) {
	const cliEntry = fileURLToPath(new URL("../../../src/cli.ts", import.meta.url));
	const cwd = fileURLToPath(new URL("../../../", import.meta.url));
	return spawnSession({
		command: process.execPath,
		args: ["--conditions=source", "--import", "tsx", cliEntry, "--model", "gpt-5.5", "--no-skills", "--config-profile", "live"],
		cwd,
		cols: 180,
		rows: 48,
		env: {
			...process.env,
			XDG_CONFIG_HOME: xdgConfigHome,
		},
	});
}

async function writeLiveConfig(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "cua-cli-live-e2e-"));
	const cuaConfigDir = join(root, "cua");
	const configPath = join(cuaConfigDir, "config.toml");
	await mkdir(cuaConfigDir, { recursive: true });
	await writeFile(
		configPath,
		[
			'default_profile = "live"',
			"",
			"[profiles.live]",
			`openai_api_key = "${OPENAI_API_KEY ?? ""}"`,
			`kernel_api_key = "${KERNEL_API_KEY ?? ""}"`,
			"",
		].join("\n"),
		"utf8",
	);
	return root;
}

async function exitSession(session: ReturnType<typeof spawnLiveSession>): Promise<void> {
	session.press(KeyCtrlC);
	try {
		await session.waitForExit({ timeoutMs: 1_500 });
		return;
	} catch {
		// fallthrough
	}

	try {
		await session.waitForVisible("aborted", { timeoutMs: 2_500 });
	} catch {
		// a settled turn may not emit an explicit abort notice
	}

	await session.waitForStable(100, { timeoutMs: 5_000 });
	session.press(KeyCtrlC);
	await session.waitForExit({ timeoutMs: 7_000 });
}
