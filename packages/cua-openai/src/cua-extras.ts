/**
 * cua extension actions for the OpenAI gpt-5.4 batch tool.
 *
 * These four actions (`goto`, `back`, `forward`, `url`) are NOT part of
 * OpenAI's official `computer` tool action set — they are convenience
 * verbs we add on top because every browser-automation prompt needs them.
 * They compile down to ordinary keyboard chords and (for `url`) a
 * clipboard read against the same Kernel `browsers.computer.*` endpoints.
 *
 * To drop these from a deployment, omit the union members from your
 * tool's parameter schema and (optionally) gate them out of the
 * translator's `executeBatch` switch.
 */

import { type Static, Type } from "@sinclair/typebox";

export const OPENAI_CUA_EXTRA_ACTION_TYPES = ["goto", "back", "forward", "url"] as const;

export type OpenAICuaExtraActionType = (typeof OPENAI_CUA_EXTRA_ACTION_TYPES)[number];

/**
 * Schema for one cua-added action when emitted as part of a
 * batch_computer_actions call. Matches the canonical model action shape
 * `ComputerTranslator.executeBatch` understands.
 */
export const OpenAICuaExtraActionSchema = Type.Object(
	{
		type: Type.String({
			description: "cua extension action (not part of OpenAI's official computer-use action set).",
			enum: [...OPENAI_CUA_EXTRA_ACTION_TYPES],
		}),
		url: Type.Optional(
			Type.String({ description: "Required when type='goto'. Fully qualified URL to navigate to." }),
		),
	},
	{ additionalProperties: false },
);

export type OpenAICuaExtraAction = Static<typeof OpenAICuaExtraActionSchema>;
