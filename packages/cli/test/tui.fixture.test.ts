import { describe, test } from "vitest";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

/**
 * Drive the interactive TUI through ptywright with a scripted provider sitting
 * below the real {@link CuaAgentHarness}. The runner script ({@link tuiRunnerPath})
 * registers the scripted provider, assembles the harness via the production
 * {@link buildCuaHarness}, and starts {@link runInteractive}. Each test case
 * spawns a fresh process with its own per-scenario fixture JSON so the
 * scripted provider's sequential turn replay never crosses scenarios.
 *
 * ptywright requires a native ghostty-vt binding (built via Zig). When that
 * binding is missing the suite is skipped by default; set PTYWRIGHT_REQUIRED=1
 * (CI uses this) to turn the silent skip into a failure.
 */

const tuiRunnerPath = fileURLToPath(new URL("./fixtures/tui-fixture-runner.ts", import.meta.url));
const require = createRequire(import.meta.url);
const tsxCliPath = require.resolve("tsx/cli");
const fixtureDir = fileURLToPath(new URL("./fixtures/tui-fixtures/", import.meta.url));
const cwd = fileURLToPath(new URL("../", import.meta.url));

const ptywrightDist = fileURLToPath(new URL("../../ptywright/dist/index.js", import.meta.url));
const ptywrightNative = resolve(dirname(ptywrightDist), "..", "native", "build", "Release", "ptywright_native.node");
const ptywrightAvailable = existsSync(ptywrightNative);

if (!ptywrightAvailable && process.env.PTYWRIGHT_REQUIRED) {
	throw new Error(
		`ptywright native binding not found at ${ptywrightNative}; build with 'npm run build --workspace @onkernel/ptywright' or unset PTYWRIGHT_REQUIRED`,
	);
}

const suite = ptywrightAvailable ? describe : describe.skip;
const WAIT_MS = 15_000;

suite("TUI ptywright scenarios", () => {
	test("streams assistant text into the message list", async (ctx) => {
		const { spawnFixture, exitFixture, waitForFixtureReady } = await loadPtywrightHelpers();
		const session = spawnFixture("streaming.json");
		ctx.onTestFinished(() => session.close());

		await waitForFixtureReady(session);
		session.line("say hi");
		await session.waitForVisible("fixture response", { timeoutMs: WAIT_MS });

		const snapshot = session.snapshot();
		assert.match(snapshot.visible, /say hi/);
		assert.match(snapshot.visible, /fixture response/);

		await exitFixture(session);
	});

	test("keeps multiline drafts left aligned", async (ctx) => {
		const { spawnFixture, exitFixture, waitForFixtureReady, KeyEnter } = await loadPtywrightHelpers();
		const session = spawnFixture("multiline.json");
		ctx.onTestFinished(() => session.close());

		await waitForFixtureReady(session);
		session.send("first line\\");
		session.press(KeyEnter);
		session.send("second line");
		await session.waitForVisible("second line", { timeoutMs: WAIT_MS });

		const beforeSubmit = session.snapshot();
		assert.match(beforeSubmit.visible, /^second line/m);
		assert.doesNotMatch(beforeSubmit.visible, /^\s+second line/m);

		session.press(KeyEnter);
		await session.waitForVisible("multiline ok", { timeoutMs: WAIT_MS });

		await exitFixture(session);
	});

	test("aborts a running turn with ctrl+c and recovers on the next prompt", async (ctx) => {
		const { spawnFixture, exitFixture, waitForFixtureReady, KeyCtrlC } = await loadPtywrightHelpers();
		const session = spawnFixture("abort.json");
		ctx.onTestFinished(() => session.close());

		await waitForFixtureReady(session);
		session.line("please run forever");
		await session.waitForVisible("working...", { timeoutMs: WAIT_MS });

		session.press(KeyCtrlC);
		await session.waitForVisible("aborted", { timeoutMs: WAIT_MS });

		session.line("recover after abort");
		await session.waitForVisible("fixture response", { timeoutMs: WAIT_MS });

		await exitFixture(session);
	});

	test("renders assistant errors as error notices", async (ctx) => {
		const { spawnFixture, exitFixture, waitForFixtureReady } = await loadPtywrightHelpers();
		const session = spawnFixture("error.json");
		ctx.onTestFinished(() => session.close());

		await waitForFixtureReady(session);
		session.line("please fail");
		await session.waitForVisible("fixture provider failed", { timeoutMs: WAIT_MS });

		const snapshot = session.snapshot();
		assert.match(snapshot.visible, /error fixture provider failed/);

		await exitFixture(session);
	});
});

/**
 * Lazy-load ptywright so missing native bindings only fail this suite. The
 * suite is gated behind `describe.skip` when the binding is missing, but the
 * dynamic import also keeps the import graph clean for the rest of vitest.
 */
async function loadPtywrightHelpers() {
	const ptywright = await import("@onkernel/ptywright");
	const { KeyCtrlC, KeyEnter, spawnSession } = ptywright;

	const spawnFixture = (fixtureFile: string) =>
		spawnSession({
			command: process.execPath,
			args: [tsxCliPath, tuiRunnerPath, resolve(fixtureDir, fixtureFile)],
			cwd,
			cols: 160,
			rows: 40,
			env: {
				...process.env,
				KERNEL_API_KEY: "fixture-key",
				OPENAI_API_KEY: "fixture-key",
			},
		});

	type FixtureSession = ReturnType<typeof spawnFixture>;

	async function waitForFixtureReady(session: FixtureSession): Promise<void> {
		await session.waitForVisible("openai/gpt-5.5", { timeoutMs: WAIT_MS });
	}

	async function exitFixture(session: FixtureSession): Promise<void> {
		try {
			await session.waitForStable(100, { timeoutMs: 2_000 });
		} catch {
			// fall through to abort-then-exit path
		}

		session.press(KeyCtrlC);
		try {
			await session.waitForExit({ timeoutMs: 1_500 });
			return;
		} catch {
			// continue to the second-ctrl-c path
		}
		try {
			await session.waitForVisible("aborted", { timeoutMs: 2_000 });
		} catch {
			// first ctrl+c may have landed during final run settlement
		}
		await session.waitForStable(100, { timeoutMs: 5_000 });
		session.press(KeyCtrlC);
		await session.waitForExit({ timeoutMs: 5_000 });
	}

	return { spawnFixture, exitFixture, waitForFixtureReady, KeyCtrlC, KeyEnter };
}
