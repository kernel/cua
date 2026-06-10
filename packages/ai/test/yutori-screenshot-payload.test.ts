import { describe, expect, it, vi } from "vitest";
import { getCuaModel, yutori } from "../src/index";

const model = getCuaModel("yutori:n1.5-latest");
const screenshotBytes = Buffer.from("fake-image-bytes");

function getScreenshotStub() {
	return vi.fn(async () => ({ data: screenshotBytes, mimeType: "image/webp" }));
}

describe("yutoriCuaOnPayload screenshot append", () => {
	it("appends a screenshot to the latest user message", async () => {
		const getScreenshot = getScreenshotStub();
		const payload = { messages: [{ role: "user", content: "Inspect the page" }] };

		const result = (await yutori.yutoriCuaOnPayload(payload, model, { getScreenshot })) as {
			messages: Array<{ role: string; content: Array<Record<string, unknown>> }>;
		};

		expect(getScreenshot).toHaveBeenCalledTimes(1);
		const content = result.messages[0]!.content;
		expect(content[0]).toEqual({ type: "text", text: "Inspect the page" });
		expect(content.at(-1)).toEqual({
			type: "image_url",
			image_url: {
				url: `data:image/webp;base64,${screenshotBytes.toString("base64")}`,
				detail: "high",
			},
		});
		// the original payload is not mutated
		expect(payload.messages[0]!.content).toBe("Inspect the page");
	});

	it("does not append again when the latest message already has an image", async () => {
		const getScreenshot = getScreenshotStub();
		const existingContent = [
			{ type: "text", text: "tool result" },
			{ type: "image_url", image_url: { url: "data:image/webp;base64,already-there" } },
		];
		const payload = { messages: [{ role: "tool", content: existingContent }] };

		const result = (await yutori.yutoriCuaOnPayload(payload, model, { getScreenshot })) as {
			messages: Array<{ content: unknown }>;
		};

		expect(getScreenshot).not.toHaveBeenCalled();
		expect(result.messages[0]!.content).toBe(existingContent);
	});

	it("skips the append when the latest message is not a user or tool message", async () => {
		const getScreenshot = getScreenshotStub();
		const payload = { messages: [{ role: "assistant", content: "done" }] };

		const result = (await yutori.yutoriCuaOnPayload(payload, model, { getScreenshot })) as {
			messages: Array<{ content: unknown }>;
		};

		expect(getScreenshot).not.toHaveBeenCalled();
		expect(result.messages[0]!.content).toBe("done");
	});

	it("skips the append when no screenshot capture is provided", async () => {
		const payload = { messages: [{ role: "user", content: "Inspect the page" }] };

		const result = (await yutori.yutoriCuaOnPayload(payload, model, {})) as {
			messages: Array<{ content: unknown }>;
		};

		expect(result.messages[0]!.content).toBe("Inspect the page");
	});
});
