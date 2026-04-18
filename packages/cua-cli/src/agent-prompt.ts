import type { Agent, AgentMessage } from "@mariozechner/pi-agent-core";
import type { ImageContent, TextContent } from "@mariozechner/pi-ai";
import type { ComputerTranslator } from "@onkernel/cua-translator";

export interface PromptOptions {
	/**
	 * If true (default), the first user prompt of a fresh agent transcript
	 * also carries an `image` content part with a freshly captured
	 * screenshot. Mirrors `internal/agent/agent.go:Run` first-turn
	 * behaviour from the cua reference implementation.
	 */
	includeInitialScreenshot?: boolean;
	/**
	 * Force-skip the initial-screenshot injection even on a fresh
	 * transcript. Used when resuming a persisted session: the agent
	 * already has prior conversation context and the new browser is on a
	 * blank tab, so adding a blank-page screenshot is just noise.
	 */
	skipInitialScreenshot?: boolean;
}

function hasPriorTurn(agent: Agent): boolean {
	for (const msg of agent.state.messages) {
		if (msg.role === "user" || msg.role === "assistant") return true;
	}
	return false;
}

/**
 * Send a user prompt to the agent. On the first turn of a fresh
 * transcript the helper also captures and attaches a screenshot, giving
 * the model immediate visual context for the browser. Subsequent turns
 * rely on tool-result screenshots flowing through the message history.
 */
export async function promptWithScreenshot(args: {
	agent: Agent;
	translator: ComputerTranslator;
	prompt: string;
	options?: PromptOptions;
}): Promise<void> {
	const { agent, translator, prompt } = args;
	const includeShot = args.options?.includeInitialScreenshot !== false;
	const skipShot = args.options?.skipInitialScreenshot === true;
	const isFirst = !hasPriorTurn(agent);

	if (!isFirst || !includeShot || skipShot) {
		await agent.prompt(prompt);
		return;
	}

	let screenshot: Buffer | undefined;
	try {
		screenshot = await translator.screenshotRaw();
	} catch {
		// Fall back to text-only first turn if screenshot fails.
	}

	const content: (TextContent | ImageContent)[] = [{ type: "text", text: prompt }];
	if (screenshot) {
		content.push({
			type: "image",
			data: screenshot.toString("base64"),
			mimeType: "image/png",
		});
	}
	const message: AgentMessage = {
		role: "user",
		content,
		timestamp: Date.now(),
	};
	await agent.prompt(message);
}
