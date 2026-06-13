import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeExecutionEnv } from "@onkernel/cua-agent";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverCuaSkills } from "../src/harness-skills";

/**
 * Skill/context discovery is hermetic: pi's resource loader reads
 * `$HOME/.agents/skills` and `<cwd>/.agents/skills`, so each test isolates
 * `HOME` and uses a fresh empty cwd plus an explicit temp `agentDir`. That way
 * the only resources in scope are the fixtures the test writes.
 */
let originalHome: string | undefined;
let cwd: string;
let agentDir: string;

beforeEach(() => {
	originalHome = process.env.HOME;
	const home = mkdtempSync(join(tmpdir(), "cua-home-"));
	process.env.HOME = home;
	cwd = mkdtempSync(join(tmpdir(), "cua-cwd-"));
	agentDir = mkdtempSync(join(tmpdir(), "cua-agentdir-"));
});

afterEach(() => {
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
});

function writeSkill(dir: string, name: string, description: string, body: string): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`);
}

function writeSettings(packages: string[]): void {
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages }, null, 2));
}

describe("discoverCuaSkills", () => {
	it("discovers a skill bundled in a pi-installed package", async () => {
		// A local package fixture mirrors what `pi install` leaves on disk: the
		// package is recorded in settings.json and its skills live under
		// <package>/skills/<name>/SKILL.md.
		const pkgDir = join(agentDir, "weather-pkg");
		writeSkill(join(pkgDir, "skills", "weather"), "weather", "Check the weather forecast.", "Run the weather workflow.");
		writeSettings([pkgDir]);

		const env = new NodeExecutionEnv({ cwd });
		const result = await discoverCuaSkills({ cwd, env, agentDir });

		const weather = result.skills.find((s) => s.name === "weather");
		expect(weather, "package skill should be discovered").toBeDefined();
		expect(weather?.content).toContain("Run the weather workflow.");
		// The skill came from the package, not ~/.agents/skills (which is empty here).
		expect(result.skills).toHaveLength(1);
	});

	it("loads each package skill once when a skills root mixes loose and nested skills", async () => {
		// A skills root holding both a loose `.md` and a nested `<name>/SKILL.md`
		// must yield both skills exactly once (the nested skill's directory and
		// the root both surface it).
		const pkgDir = join(agentDir, "mixed-pkg");
		const skillsRoot = join(pkgDir, "skills");
		mkdirSync(skillsRoot, { recursive: true });
		writeFileSync(join(skillsRoot, "loose.md"), "---\nname: loose\ndescription: A loose skill.\n---\nLoose body.\n");
		writeSkill(join(skillsRoot, "nested"), "nested", "A nested skill.", "Nested body.");
		writeSettings([pkgDir]);

		const env = new NodeExecutionEnv({ cwd });
		const result = await discoverCuaSkills({ cwd, env, agentDir });

		expect(result.skills.map((s) => s.name).sort()).toEqual(["loose", "nested"]);
	});

	it("skips a configured-but-not-installed package without throwing or hanging", async () => {
		// An npm package that was never installed. Resolution must not attempt a
		// network install or block; the package is skipped and discovery returns
		// cleanly with no skills.
		writeSettings(["npm:@example/totally-not-installed-package"]);

		const env = new NodeExecutionEnv({ cwd });
		const result = await discoverCuaSkills({ cwd, env, agentDir });

		expect(result.skills).toHaveLength(0);
	});

	it("loads skills from an explicit --skill path", async () => {
		const extraDir = mkdtempSync(join(tmpdir(), "cua-extra-skill-"));
		writeSkill(join(extraDir, "deploy"), "deploy", "Ship the build.", "Run the deploy steps.");

		const env = new NodeExecutionEnv({ cwd });
		const result = await discoverCuaSkills({ cwd, env, agentDir, extraPaths: [extraDir] });

		expect(result.skills.map((s) => s.name)).toContain("deploy");
	});

	it("returns no skills when disabled, but still loads context files", async () => {
		const pkgDir = join(agentDir, "weather-pkg");
		writeSkill(join(pkgDir, "skills", "weather"), "weather", "Check the weather forecast.", "Run the weather workflow.");
		writeSettings([pkgDir]);
		writeFileSync(join(cwd, "AGENTS.md"), "# Project context\n\nBe concise.\n");

		const env = new NodeExecutionEnv({ cwd });
		const result = await discoverCuaSkills({ cwd, env, agentDir, disabled: true });

		expect(result.skills).toHaveLength(0);
		expect(result.contextFiles.map((f) => f.path)).toContain(join(cwd, "AGENTS.md"));
	});

	it("loads an AGENTS.md context file from the cwd", async () => {
		writeFileSync(join(cwd, "AGENTS.md"), "# Project context\n\nUse two-space indentation.\n");

		const env = new NodeExecutionEnv({ cwd });
		const result = await discoverCuaSkills({ cwd, env, agentDir });

		const agents = result.contextFiles.find((f) => f.path === join(cwd, "AGENTS.md"));
		expect(agents, "AGENTS.md should be discovered").toBeDefined();
		expect(agents?.content).toContain("Use two-space indentation.");
	});
});
