import {
	formatSkillsForPrompt,
	loadProjectContextFiles,
	loadSkills,
	type ResourceDiagnostic,
	type Skill,
} from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface DiscoverSkillsOptions {
	cwd: string;
	/** Extra explicit skill paths (files or directories) from --skill / --skill-dir flags. */
	extraPaths?: string[];
	/** Disable all skill discovery. */
	disabled?: boolean;
}

export interface StartupContextFile {
	path: string;
	content: string;
}

export interface StartupResources {
	contextFiles: StartupContextFile[];
	skills: Skill[];
	skillDiagnostics: ResourceDiagnostic[];
}

/**
 * Discover skills following the cross-agent `~/.agents/skills/` standard.
 *
 * Discovery order (first wins on name collision):
 *   1. Explicit paths from `extraPaths` (`--skill <path>` flags).
 *   2. `~/.agents/skills/` (user-global, shared across any agent that
 *      respects the standard).
 *   3. `<cwd>/.agents/skills/` (project-local).
 *
 * Skills' frontmatter `description` and `location` are added to the
 * system prompt; the model uses the `read` tool to load a skill's body
 * when the description matches the task. Use `/skill:<name>` in a
 * prompt to force-load a skill body inline.
 */
export function discoverCuaSkills(opts: DiscoverSkillsOptions): {
	skills: Skill[];
	sources: string[];
	diagnostics: ResourceDiagnostic[];
} {
	if (opts.disabled) return { skills: [], sources: [], diagnostics: [] };

	const userAgentsDir = join(homedir(), ".agents", "skills");
	const projectAgentsDir = join(opts.cwd, ".agents", "skills");
	const extras = opts.extraPaths?.filter((p) => p && p.trim().length > 0) ?? [];

	const skillPaths: string[] = [];
	for (const p of [...extras, userAgentsDir, projectAgentsDir]) {
		if (existsSync(p)) skillPaths.push(p);
	}

	// `includeDefaults: false` because pi-coding-agent's defaults are
	// `~/.pi/agent/skills/` etc., which are pi-specific. cua follows the
	// emerging cross-agent `~/.agents/skills/` standard instead and
	// passes those paths explicitly above.
	const result = loadSkills({
		cwd: opts.cwd,
		skillPaths,
		includeDefaults: false,
	});

	return { skills: result.skills, sources: skillPaths, diagnostics: result.diagnostics };
}

export function discoverStartupResources(opts: DiscoverSkillsOptions): StartupResources {
	const skills = discoverCuaSkills(opts);
	return {
		contextFiles: loadProjectContextFiles({ cwd: opts.cwd }),
		skills: skills.skills,
		skillDiagnostics: skills.diagnostics,
	};
}

/** Append the rendered skills block to a system prompt, if any skills are present. */
export function appendSkillsToSystemPrompt(systemPrompt: string, skills: Skill[]): string {
	if (skills.length === 0) return systemPrompt;
	const formatted = formatSkillsForPrompt(skills);
	if (!formatted.trim()) return systemPrompt;
	return systemPrompt.trim() + "\n\n" + formatted.trim() + "\n";
}

/**
 * Resolve a `/skill:<name>` invocation into the full skill body so the
 * model gets the explicit instructions on the next turn. The text
 * supplied by the user (the part after the skill name, if any) is
 * appended as additional context.
 */
export function expandSkillInvocation(text: string, skills: Skill[]): { expanded: string; skill?: Skill } {
	const trimmed = text.trim();
	const match = trimmed.match(/^\/skill:([A-Za-z0-9_\-.]+)\s*(.*)$/);
	if (!match) return { expanded: text };
	const [, name, rest] = match;
	const skill = skills.find((s) => s.name === name);
	if (!skill) {
		return {
			expanded: `(no skill named "${name}" was found; pretending the user typed: ${rest || "(empty)"})\n\n${rest}`,
		};
	}
	const remainder = (rest ?? "").trim();
	const body =
		`Use the following skill ("${skill.name}"): ${skill.description}\n\n` +
		`${skill.filePath}:\n\n---\n${tryReadSkillBody(skill.filePath)}\n---\n` +
		(remainder ? `\nUser request:\n${remainder}` : "");
	return { expanded: body, skill };
}

function tryReadSkillBody(path: string): string {
	try {
		return readFileSync(path, "utf8");
	} catch (err) {
		return `(failed to read skill at ${path}: ${(err as Error).message})`;
	}
}

export type { Skill };
