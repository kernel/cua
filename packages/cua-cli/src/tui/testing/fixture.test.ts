import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { KeyCtrlC, KeyEnter, spawnSession } from "@onkernel/ptywright";

function spawnFixture() {
	const fixtureMain = fileURLToPath(new URL("./fixture-main", import.meta.url));
	const fixtureJson = fileURLToPath(new URL("../../../src/tui/testing/fixtures/basic.json", import.meta.url));
	const cwd = fileURLToPath(new URL("../../../", import.meta.url));
	return spawnSession({
		command: process.execPath,
		args: [fixtureMain, fixtureJson],
		cwd,
		cols: 160,
		rows: 40,
	});
}

test("fixture TUI renders submitted prompts and assistant text", async (t) => {
	const session = spawnFixture();
	t.after(() => session.close());

	await waitForFixtureReady(session);
	session.line("say hi");
	await session.waitForVisible("fixture response", { timeoutMs: 10_000 });

	const snapshot = session.snapshot();
	assert.match(snapshot.visible, /say hi/);
	assert.match(snapshot.visible, /fixture response/);

	await exitFixture(session);
});

test("fixture TUI keeps multiline drafts left aligned", async (t) => {
	const session = spawnFixture();
	t.after(() => session.close());

	await waitForFixtureReady(session);
	session.send("first line\\");
	session.press(KeyEnter);
	session.send("second line");
	await session.waitForVisible("second line", { timeoutMs: 10_000 });

	const beforeSubmit = session.snapshot();
	assert.match(beforeSubmit.visible, /^second line/m);
	assert.doesNotMatch(beforeSubmit.visible, /^\s+second line/m);

	session.press(KeyEnter);
	await session.waitForVisible("multiline ok", { timeoutMs: 10_000 });

	await exitFixture(session);
});

test("fixture TUI can abort a running turn and recover", async (t) => {
	const session = spawnFixture();
	t.after(() => session.close());

	await waitForFixtureReady(session);
	session.line("please run forever");
	await session.waitForVisible("working...", { timeoutMs: 10_000 });

	session.press(KeyCtrlC);
	await session.waitForVisible("aborted", { timeoutMs: 10_000 });

	session.line("say hi");
	await session.waitForVisible("fixture response", { timeoutMs: 10_000 });

	await exitFixture(session);
});

test("fixture TUI renders assistant errors", async (t) => {
	const session = spawnFixture();
	t.after(() => session.close());

	await waitForFixtureReady(session);
	session.line("please fail");
	await session.waitForVisible("fixture provider failed", { timeoutMs: 10_000 });

	const snapshot = session.snapshot();
	assert.match(snapshot.visible, /error fixture provider failed/);

	await exitFixture(session);
});

async function waitForFixtureReady(session: ReturnType<typeof spawnFixture>) {
	await session.waitForVisible("fixture/fixture-model", { timeoutMs: 10_000 });
}

async function exitFixture(session: ReturnType<typeof spawnFixture>) {
	try {
		await session.waitForStable(100, { timeoutMs: 2_000 });
	} catch {
		// If the UI is still streaming, fall back to the abort-then-exit path below.
	}

	session.press(KeyCtrlC);
	try {
		await session.waitForExit({ timeoutMs: 1_500 });
	} catch {
		try {
			await session.waitForVisible("aborted", { timeoutMs: 2_000 });
		} catch {
			// The first Ctrl+C may have landed during final run settlement without emitting an abort notice.
		}
		await session.waitForStable(100, { timeoutMs: 5_000 });
		session.press(KeyCtrlC);
		await session.waitForExit({ timeoutMs: 5_000 });
	}
}
