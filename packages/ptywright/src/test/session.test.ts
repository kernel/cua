import assert from "node:assert/strict";
import test from "node:test";
import { KeyCtrlD, spawnSession } from "../index.js";

test("session captures transcript and visible screen", async (t) => {
	const session = spawnSession({
		command: "/bin/sh",
		args: ["-lc", "printf 'ready\\n'; cat"],
		cols: 80,
		rows: 12,
	});
	t.after(() => session.close());

	await session.waitForVisible("ready", { timeoutMs: 5_000 });
	session.line("ping");
	await session.waitForTranscript("ping", { timeoutMs: 5_000 });

	const snapshot = session.snapshot();
	assert.match(snapshot.transcript, /ready/);
	assert.match(snapshot.transcript, /ping/);
	assert.match(snapshot.visible, /ping/);

	session.press(KeyCtrlD);
	const status = await session.waitForExit({ timeoutMs: 5_000 });
	assert.equal(status.exitCode, 0);
});

test("session resize updates the virtual terminal dimensions", async (t) => {
	const session = spawnSession({
		command: "/bin/sh",
		args: ["-lc", "printf 'resize-me\\n'; cat"],
		cols: 40,
		rows: 8,
	});
	t.after(() => session.close());

	await session.waitForVisible("resize-me", { timeoutMs: 5_000 });
	session.resize(100, 30);

	const snapshot = session.snapshot();
	assert.equal(snapshot.width, 100);
	assert.equal(snapshot.height, 30);
});

test("session writes terminal query replies back to the child PTY", async (t) => {
	const script = [
		"import os, sys, termios, tty",
		"fd = sys.stdin.fileno()",
		"old = termios.tcgetattr(fd)",
		"try:",
		"    tty.setraw(fd)",
		"    os.write(sys.stdout.fileno(), b'\\x1b[?7$p')",
		"    reply = os.read(fd, 64)",
		"    os.write(sys.stdout.fileno(), b'\\nreply:' + reply.hex().encode() + b'\\n')",
		"finally:",
		"    termios.tcsetattr(fd, termios.TCSANOW, old)",
	].join("\n");
	const session = spawnSession({
		command: "python3",
		args: ["-c", script],
		cols: 80,
		rows: 12,
	});
	t.after(() => session.close());

	await session.waitForTranscript("reply:", { timeoutMs: 5_000 });
	const snapshot = session.snapshot();
	assert.match(snapshot.transcript, /reply:1b5b3f373b[0-9a-f]+2479/);

	const status = await session.waitForExit({ timeoutMs: 5_000 });
	assert.equal(status.exitCode, 0);
});
