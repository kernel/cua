import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { BrowserSession } from "@onkernel/cua-translator";
import type { Config } from "../../config.js";
import { runInteractive } from "../main.js";
import { ScriptedDriver, type ScriptedFixture } from "./scripted-driver.js";

async function main(): Promise<void> {
	const fixtureArg = process.argv[2];
	if (!fixtureArg) {
		throw new Error("usage: node fixture-main.js <fixture.json>");
	}

	const fixturePath = resolve(process.cwd(), fixtureArg);
	const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as ScriptedFixture;
	const driver = new ScriptedDriver(fixture);
	const browser = {
		client: {} as BrowserSession["client"],
		sessionId: fixture.browserSession ?? "fixture-session-123456",
		liveUrl: fixture.liveUrl,
		close: async () => {},
	} as BrowserSession;

	await runInteractive({
		cwd: process.cwd(),
		browser,
		config: {} as Config,
		modelId: fixture.model ?? "fixture-model",
		driver,
	});
}

main().catch((error) => {
	process.stderr.write(`fixture error: ${(error as Error).message}\n`);
	process.exit(1);
});
