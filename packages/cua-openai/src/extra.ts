import type { ComputerTranslator, ComputerUseToolResult } from "@onkernel/cua-translator";
import { type Static, Type } from "@sinclair/typebox";

export const OPENAI_EXTRA_TOOL_NAME = "computer_use_extra";

export const OPENAI_EXTRA_TOOL_DESCRIPTION = "High-level browser actions for navigation and URL retrieval.";

export const ExtraSchema = Type.Object(
	{
		action: Type.Union([Type.Literal("goto"), Type.Literal("back"), Type.Literal("url")], {
			description: "Action to perform: goto, back, or url.",
		}),
		url: Type.Optional(
			Type.String({
				description: "Required when action is goto. Fully qualified URL to navigate to.",
			}),
		),
	},
	{ additionalProperties: false },
);

export type ExtraToolInput = Static<typeof ExtraSchema>;

export interface ExtraToolDetails {
	action: "goto" | "back" | "url";
	url?: string;
	statusText: string;
	error?: string;
}

export const OPENAI_EXTRA_TOOL = {
	type: "function",
	name: OPENAI_EXTRA_TOOL_NAME,
	description: OPENAI_EXTRA_TOOL_DESCRIPTION,
	parameters: ExtraSchema,
	strict: false,
} as const;

const SETTLE_MS = 300;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function executeOpenAIExtraAction(
	translator: ComputerTranslator,
	params: ExtraToolInput,
): Promise<ComputerUseToolResult<ExtraToolDetails>> {
	const action = params.action;
	let statusText = "Action executed successfully.";
	let resolvedUrl: string | undefined;
	let execErr: Error | undefined;
	const content: ComputerUseToolResult<ExtraToolDetails>["content"] = [];

	try {
		if (action === "goto") {
			const url = (params.url ?? "").trim();
			if (!url) throw new Error('action="goto" requires a url');
			await translator.executeBatch([{ type: "goto", url }]);
			statusText = "goto executed successfully.";
			resolvedUrl = url;
		} else if (action === "back") {
			await translator.executeBatch([{ type: "back" }]);
			statusText = "back executed successfully.";
		} else if (action === "url") {
			const url = await translator.currentUrl();
			statusText = `Current URL: ${url}`;
			resolvedUrl = url;
		} else {
			throw new Error(`unknown computer_use_extra action: ${action satisfies never}`);
		}
	} catch (err) {
		execErr = err instanceof Error ? err : new Error(String(err));
		statusText = `${action} failed: ${execErr.message}`;
	}

	content.push({ type: "text", text: statusText });

	if (!execErr) await delay(SETTLE_MS);
	try {
		const png = await translator.screenshotRaw();
		content.push({ type: "image", data: png.toString("base64"), mimeType: "image/png" });
	} catch (shotErr) {
		content[0] = {
			type: "text",
			text: `${statusText} Screenshot unavailable: ${(shotErr as Error).message}`,
		};
	}

	const details: ExtraToolDetails = {
		action,
		statusText,
		...(resolvedUrl ? { url: resolvedUrl } : {}),
		...(execErr ? { error: execErr.message } : {}),
	};

	return {
		content,
		details,
		...(execErr ? { isError: true } : {}),
	};
}
