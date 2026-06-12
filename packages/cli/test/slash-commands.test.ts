import { describe, expect, it } from "vitest";
import { parseSlashCommand } from "../src/tui/slash-commands";

describe("parseSlashCommand", () => {
	it("returns undefined for non-slash input", () => {
		expect(parseSlashCommand("hello world")).toBeUndefined();
		expect(parseSlashCommand("")).toBeUndefined();
	});

	it("parses /model with a provider:model argument", () => {
		expect(parseSlashCommand("/model openai:gpt-5.5")).toEqual({
			command: "model",
			argument: "openai:gpt-5.5",
		});
		expect(parseSlashCommand("/model")).toEqual({ command: "model", argument: "" });
	});

	it("parses /thinking with a reasoning level", () => {
		expect(parseSlashCommand("/thinking high")).toEqual({
			command: "thinking",
			argument: "high",
		});
	});

	it("parses /compact", () => {
		expect(parseSlashCommand("/compact")).toEqual({ command: "compact", argument: "" });
	});

	it("parses /skill:<name> with optional remainder", () => {
		expect(parseSlashCommand("/skill:hello")).toEqual({
			command: "skill",
			name: "hello",
			remainder: "",
		});
		expect(parseSlashCommand("/skill:hello with args")).toEqual({
			command: "skill",
			name: "hello",
			remainder: "with args",
		});
	});

	it("returns undefined for unknown slash commands", () => {
		expect(parseSlashCommand("/totally-unknown-command")).toBeUndefined();
	});
});
