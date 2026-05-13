/**
 * Refresh the vendored pi agent core files used by `@onkernel/cua-agent`.
 *
 * The published pi agent package does not currently expose the `AgentHarness`
 * APIs this package extends, so we vendor the minimal source set from a pinned
 * official `earendil-works/pi` commit with its MIT license.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PI_COMMIT = "40c05f55391663024a6a05ad33249b616a04e7a1";
const FILES = [
	"agent.ts",
	"agent-loop.ts",
	"harness/agent-harness.ts",
	"harness/compaction/branch-summarization.ts",
	"harness/compaction/compaction.ts",
	"harness/compaction/utils.ts",
	"harness/env/nodejs.ts",
	"harness/execution-env.ts",
	"harness/messages.ts",
	"harness/prompt-templates.ts",
	"harness/session/repo/jsonl.ts",
	"harness/session/repo/memory.ts",
	"harness/session/repo/shared.ts",
	"harness/session/session.ts",
	"harness/session/storage/jsonl.ts",
	"harness/session/storage/memory.ts",
	"harness/session/uuid.ts",
	"harness/skills.ts",
	"harness/system-prompt.ts",
	"harness/types.ts",
	"harness/utils/shell-output.ts",
	"harness/utils/truncate.ts",
	"index.ts",
	"proxy.ts",
	"types.ts",
];

const __dirname = dirname(fileURLToPath(import.meta.url));
const vendorRoot = join(__dirname, "../src/vendor/pi-agent-core");
const repoRawBase = `https://raw.githubusercontent.com/earendil-works/pi/${PI_COMMIT}`;
const rawBase = `${repoRawBase}/packages/agent/src`;

for (const file of FILES) {
	const response = await fetch(`${rawBase}/${file}`);
	if (!response.ok) {
		throw new Error(`Failed to fetch ${file}: ${response.status} ${response.statusText}`);
	}
	const outputPath = join(vendorRoot, file);
	await mkdir(dirname(outputPath), { recursive: true });
	await writeFile(outputPath, await response.text());
	console.log(`vendored ${file}`);
}

const licenseResponse = await fetch(`${repoRawBase}/LICENSE`);
if (!licenseResponse.ok) {
	throw new Error(`Failed to fetch LICENSE: ${licenseResponse.status} ${licenseResponse.statusText}`);
}
await writeFile(join(vendorRoot, "LICENSE"), await licenseResponse.text());
console.log("vendored LICENSE");
