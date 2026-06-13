import { type ExecutionEnv, loadSkills, type Skill, type SkillDiagnostic } from "@onkernel/cua-agent";
import {
	DefaultResourceLoader,
	getAgentDir,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { dirname } from "node:path";

export interface DiscoverSkillsOptions {
	cwd: string;
	env: ExecutionEnv;
	/** Extra explicit skill paths (files or directories) from `--skill` flags. */
	extraPaths?: string[];
	/** Disable all skill discovery. */
	disabled?: boolean;
	/** pi agent dir to resolve installed packages from. Defaults to `getAgentDir()`. */
	agentDir?: string;
}

export interface ContextFile {
	path: string;
	content: string;
}

export interface DiscoverSkillsResult {
	skills: Skill[];
	contextFiles: ContextFile[];
	sources: string[];
	diagnostics: SkillDiagnostic[];
}

/**
 * Discover skills and context files via pi's `DefaultResourceLoader`, the same
 * loader pi's own TUI uses. This resolves skills from installed pi packages
 * (`pi install …` writes them under the agent dir and records them in
 * settings.json) in addition to `~/.agents/skills/`, `<cwd>/.agents/skills/`,
 * `~/.pi/agent/skills/`, and explicit `--skill` paths.
 *
 * Startup never blocks on an interactive prompt: project settings start
 * untrusted (no trust prompt), and `PI_OFFLINE` keeps a configured-but-not-
 * installed package from triggering a network install — it is skipped instead.
 *
 * pi extensions are not loaded (`noExtensions`): cua's harness drives the
 * lower-level `AgentHarness` directly and cannot bind pi `AgentSession`
 * extensions.
 */
export async function discoverCuaSkills(opts: DiscoverSkillsOptions): Promise<DiscoverSkillsResult> {
	const extras = (opts.extraPaths ?? []).filter((p) => p && p.trim().length > 0);
	const agentDir = opts.agentDir ?? getAgentDir();
	const settingsManager = SettingsManager.create(opts.cwd, agentDir, { projectTrusted: false });
	const loader = new DefaultResourceLoader({
		cwd: opts.cwd,
		agentDir,
		settingsManager,
		additionalSkillPaths: extras,
		noSkills: opts.disabled === true,
		noExtensions: true,
		noPromptTemplates: true,
		noThemes: true,
	});

	const restoreOffline = forceOfflinePackageResolution();
	try {
		await loader.reload();
	} finally {
		restoreOffline();
	}

	const piSkills = loader.getSkills().skills;
	const contextFiles = loader.getAgentsFiles().agentsFiles;

	// pi's loader resolves the skill *file paths* — the superset that includes
	// package skills — but its skill objects don't carry the file body. cua's
	// harness needs the full instructions, so re-read the discovered skills
	// through cua-agent's `loadSkills`, which produces the `{ content }` shape
	// the harness and `/skill:<name>` expansion consume. Scan each skill's root
	// directory, then keep only the files pi actually enumerated (so a skills
	// root holding both a loose `.md` and a nested `SKILL.md` doesn't load the
	// nested skill twice).
	const discoveredPaths = new Set(piSkills.map((s) => s.filePath));
	const skillDirs = [...new Set(piSkills.map((s) => dirname(s.filePath)))];
	if (skillDirs.length === 0) {
		return { skills: [], contextFiles, sources: [], diagnostics: [] };
	}
	const loaded = await loadSkills(opts.env, skillDirs);
	const skills = dedupeByFilePath(loaded.skills.filter((s) => discoveredPaths.has(s.filePath)));
	return { skills, contextFiles, sources: skillDirs, diagnostics: loaded.diagnostics };
}

function dedupeByFilePath(skills: Skill[]): Skill[] {
	const seen = new Set<string>();
	const result: Skill[] = [];
	for (const skill of skills) {
		if (seen.has(skill.filePath)) continue;
		seen.add(skill.filePath);
		result.push(skill);
	}
	return result;
}

/**
 * `DefaultResourceLoader.reload()` resolves packages without an `onMissing`
 * callback, which would auto-install a configured-but-missing package over the
 * network. `PI_OFFLINE` makes that resolution skip missing packages instead, so
 * startup can never hang on an install. Restores any prior value afterward.
 */
function forceOfflinePackageResolution(): () => void {
	const previous = process.env.PI_OFFLINE;
	if (previous !== undefined) return () => {};
	process.env.PI_OFFLINE = "1";
	return () => {
		delete process.env.PI_OFFLINE;
	};
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
