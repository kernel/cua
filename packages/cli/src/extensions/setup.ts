import type { CuaAgentHarness, Session } from "@onkernel/cua-agent";
import type { ImageContent } from "@onkernel/cua-ai";
import {
	getAgentDir,
	hasProjectTrustInputs,
	ProjectTrustStore,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { HarnessExtensionHost } from "./host";

/**
 * Resolve extension directories and construct + load a {@link HarnessExtensionHost}.
 *
 * Global extensions (`<getAgentDir()>/extensions`) always load; project-local
 * extensions (`<cwd>/.agents/extensions` plus `<cwd>/.pi/extensions`) only load
 * when project trust resolves true or `--trust-extensions` is set. `--no-extensions`
 * opts out entirely.
 *
 * No browser/auth/provisioning happens here, so a test can drive the exact load
 * path the CLI uses with a `buildTestHarness` fixture and temp dirs.
 */
export async function loadHarnessExtensions(args: {
	harness: CuaAgentHarness;
	session: Session;
	cwd: string;
	noExtensions: boolean;
	trustExtensions?: boolean;
	agentDir?: string;
	configuredPaths?: string[];
	initialScreenshot?: () => Promise<ImageContent[] | undefined>;
}): Promise<HarnessExtensionHost | undefined> {
	if (args.noExtensions) return undefined;
	const agentDir = args.agentDir ?? getAgentDir();
	const projectTrusted = resolveProjectExtensionTrust({
		cwd: args.cwd,
		agentDir,
		trustExtensions: args.trustExtensions === true,
	});
	const configuredPaths = args.configuredPaths ?? [join(args.cwd, ".agents", "extensions")];
	const host = new HarnessExtensionHost({
		harness: args.harness,
		session: args.session,
		cwd: args.cwd,
		configuredPaths,
		projectTrusted,
		agentDir,
		initialScreenshot: args.initialScreenshot,
	});
	await host.load();
	return host;
}

function resolveProjectExtensionTrust(args: {
	cwd: string;
	agentDir: string;
	trustExtensions: boolean;
}): boolean {
	if (args.trustExtensions) return true;
	if (!hasProjectExtensionInputs(args.cwd)) return true;
	const trustDecision = new ProjectTrustStore(args.agentDir).get(args.cwd);
	if (trustDecision !== null) return trustDecision;
	const settings = SettingsManager.create(args.cwd, args.agentDir, { projectTrusted: false });
	return settings.getDefaultProjectTrust() === "always";
}

function hasProjectExtensionInputs(cwd: string): boolean {
	return hasProjectTrustInputs(cwd) || existsSync(join(cwd, ".agents", "extensions"));
}
