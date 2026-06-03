import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { complete, getCuaModel, openai } from "../src/index";

const here = dirname(fileURLToPath(import.meta.url));
const screenshotPath = join(here, "screenshot.png");
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("Set OPENAI_API_KEY to run this example.");

const modelRef = "openai:gpt-5.5";
const model = getCuaModel(modelRef);
const screenshot = await readFile(screenshotPath);

// Other provider examples. Add the provider namespace to the top-level import
// before switching these values.
// const apiKey = process.env.ANTHROPIC_API_KEY;
// const modelRef = "anthropic:claude-opus-4-7";
// const model = getCuaModel(modelRef);
// const tools = anthropic.computerTools({ actions: ["click"] });
//
// const apiKey = process.env.GOOGLE_API_KEY;
// const modelRef = "google:gemini-2.5-computer-use-preview-10-2025";
// const model = getCuaModel(modelRef);
// const tools = gemini.computerTools({ actions: ["click"] });

const response = await complete(
	model,
	{
		systemPrompt: [
			"You are controlling a browser from a screenshot.",
			"Call the computer tool with the pixel coordinates of the target. Do not describe the click in prose unless you cannot identify the target.",
		].join("\n"),
		messages: [
			{
				role: "user",
				content: [
					{ type: "text", text: "Click the sign in / up link in this Kernel homepage screenshot." },
					{ type: "image", data: screenshot.toString("base64"), mimeType: "image/png" },
				],
				timestamp: Date.now(),
			},
		],
		tools: openai.computerTools({ actions: ["click"] }),
	},
	{
		apiKey,
		maxTokens: 1024,
	},
);

console.log(`model: ${modelRef}`);
for (const block of response.content) {
	if (block.type === "text") {
		console.log(block.text);
	}
	if (block.type === "toolCall") {
		console.log(`${block.name}: ${JSON.stringify(block.arguments)}`);
	}
}
