import { type ExecutionEnv, loadSkills, type Skill, type SkillDiagnostic } from "@onkernel/cua-agent";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface DiscoverSkillsOptions {
	cwd: string;
	env: ExecutionEnv;
	/** Extra explicit skill paths (files or directories) from `--skill` flags. */
	extraPaths?: string[];
	/** Disable all skill discovery. */
	disabled?: boolean;
}

export interface DiscoverSkillsResult {
	skills: Skill[];
	sources: string[];
	diagnostics: SkillDiagnostic[];
}

/**
 * Discover skills following the cross-agent `~/.agents/skills/` standard.
 *
 * Discovery order: explicit `--skill` paths, then `~/.agents/skills/`,
 * then `<cwd>/.agents/skills/`. Missing paths are skipped silently.
 */
export async function discoverCuaSkills(opts: DiscoverSkillsOptions): Promise<DiscoverSkillsResult> {
	if (opts.disabled) return { skills: [], sources: [], diagnostics: [] };
	const extras = (opts.extraPaths ?? []).filter((p) => p && p.trim().length > 0);
	const userAgentsDir = join(homedir(), ".agents", "skills");
	const projectAgentsDir = join(opts.cwd, ".agents", "skills");
	const candidates = [...extras, userAgentsDir, projectAgentsDir];
	const sources = candidates.filter((p) => existsSync(p));
	if (sources.length === 0) return { skills: [], sources: [], diagnostics: [] };
	const result = await loadSkills(opts.env, sources);
	return { skills: result.skills, sources, diagnostics: result.diagnostics };
}

/**
 * Resolve a `/skill:<name>` invocation. Returns the matched skill (so the
 * caller can use `harness.skill(name)`) plus any remainder text the user
 * typed after the skill name, which the caller can append as an additional
 * instruction.
 */
export function parseSkillInvocation(
	text: string,
	skills: Skill[],
): { skill?: Skill; remainder: string } | undefined {
	const trimmed = text.trim();
	const match = trimmed.match(/^\/skill:([A-Za-z0-9_\-.]+)\s*(.*)$/);
	if (!match) return undefined;
	const [, name, rest] = match;
	const skill = skills.find((s) => s.name === name);
	return { skill, remainder: (rest ?? "").trim() };
}
