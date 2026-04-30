import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { ImageContent, TextContent } from "@mariozechner/pi-ai";
import type { ComputerTranslator } from "@onkernel/cua-translator";
import { type Static } from "@sinclair/typebox";
import {
	YUTORI_DEFINITIONS,
	type YutoriComputerToolsOptions,
	type YutoriToolDetails,
	executeYutoriFunctionCall,
} from "./computer.js";

export function createYutoriPerActionTools(
	translator: ComputerTranslator,
	opts: YutoriComputerToolsOptions = {},
): AgentTool<any, any>[] {
	return YUTORI_DEFINITIONS.map((definition) => ({
		name: definition.name,
		label: definition.name,
		description: definition.description,
		parameters: definition.parameters,
		async execute(_id, params: Static<typeof definition.parameters>): Promise<AgentToolResult<YutoriToolDetails>> {
			const result = await executeYutoriFunctionCall({
				translator,
				name: definition.name,
				input: params,
				options: opts,
			});
			const content = result.content as (TextContent | ImageContent)[];
			const details = result.details;
			if (result.isError) {
				const message = details.error ?? details.statusText;
				throw Object.assign(new Error(message), { details, content });
			}
			return { content, details };
		},
	}));
}
