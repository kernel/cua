import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createSession,
	createSessionRepo,
	findLatestSession,
	listSessionsForCwd,
	resolveSessionRef,
} from "../src/harness-sessions";

function freshRoot(): string {
	return mkdtempSync(join(tmpdir(), "cua-cli-sessions-"));
}

describe("JsonlSessionRepo-backed sessions", () => {
	it("creates and lists sessions for a cwd", async () => {
		const root = freshRoot();
		const cwd = mkdtempSync(join(tmpdir(), "cua-cli-cwd-"));
		const repo = createSessionRepo(root);
		await createSession(repo, cwd);
		const sessions = await listSessionsForCwd(repo, cwd);
		expect(sessions.length).toBe(1);
		expect(sessions[0]?.cwd).toBe(cwd);
	});

	it("tolerates legacy / unknown files in the sessions root", async () => {
		const root = freshRoot();
		const cwd = mkdtempSync(join(tmpdir(), "cua-cli-cwd-"));
		const repo = createSessionRepo(root);

		// Create a session via the repo first so the root layout exists.
		await createSession(repo, cwd);

		// Now drop a legacy file alongside it that does not match the v0.79 layout.
		const legacy = join(root, "legacy-session.jsonl");
		writeFileSync(legacy, '{"role":"user","content":"hi"}\n', "utf8");
		const orphanDir = join(root, "definitely-not-a-session");
		await mkdir(orphanDir, { recursive: true });
		writeFileSync(join(orphanDir, "garbage.txt"), "noise", "utf8");

		// list() must still succeed and return only the valid session.
		const sessions = await listSessionsForCwd(repo, cwd);
		expect(sessions.length).toBe(1);
	});

	it("resolves the latest session for a cwd", async () => {
		const root = freshRoot();
		const cwd = mkdtempSync(join(tmpdir(), "cua-cli-cwd-"));
		const repo = createSessionRepo(root);
		await createSession(repo, cwd);
		await new Promise((r) => setTimeout(r, 5));
		const second = await createSession(repo, cwd);
		const latest = await findLatestSession(repo, cwd);
		expect(latest?.id).toBe((await second.getMetadata()).id);
		const viaLatest = await resolveSessionRef(repo, cwd, "latest");
		expect(viaLatest.id).toBe(latest?.id);
	});

	it("resolves by id prefix and errors on ambiguity / miss", async () => {
		const root = freshRoot();
		const cwd = mkdtempSync(join(tmpdir(), "cua-cli-cwd-"));
		const repo = createSessionRepo(root);
		const created = await createSession(repo, cwd);
		const id = (await created.getMetadata()).id;
		const byPrefix = await resolveSessionRef(repo, cwd, id.slice(0, 6));
		expect(byPrefix.id).toBe(id);
		await expect(resolveSessionRef(repo, cwd, "no-such")).rejects.toThrow(/no session matches/);
	});
});
