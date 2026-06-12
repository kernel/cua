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
): { name: string; skill?: Skill; remainder: string } | undefined {
	const trimmed = text.trim();
	const match = trimmed.match(/^\/skill:([A-Za-z0-9_\-.]+)\s*(.*)$/);
	if (!match) return undefined;
	const [, name, rest] = match;
	const skill = skills.find((s) => s.name === name);
	return { name, skill, remainder: (rest ?? "").trim() };
}

export function expandUnknownSkillInvocation(name: string, remainder: string): string {
	return `(no skill named "${name}" was found; pretending the user typed: ${remainder || "(empty)"})\n\n${remainder}`;
}

export function formatSkillInvocationPrompt(skill: Skill, additionalInstructions?: string): string {
	const skillBlock =
		`<skill name="${skill.name}" location="${skill.filePath}">\n` +
		`References are relative to ${dirnameEnvPath(skill.filePath)}.\n\n` +
		`${skill.content}\n` +
		"</skill>";
	return additionalInstructions ? `${skillBlock}\n\n${additionalInstructions}` : skillBlock;
}

function dirnameEnvPath(path: string): string {
	const normalized = path.replace(/\/+$/, "");
	const slashIndex = normalized.lastIndexOf("/");
	return slashIndex <= 0 ? "/" : normalized.slice(0, slashIndex);
}
