import { Container, Text } from "@mariozechner/pi-tui";
import { colors } from "./themes.js";

/**
 * Append-only chat log of user prompts, assistant text, tool-call summaries,
 * and inline error notes. Each entry is a Text component (or compound) so we
 * delegate wrapping to pi-tui's renderer.
 */
export class MessageList extends Container {
	addUser(text: string): void {
		this.appendBlock([colors.bold("you ") + colors.dim("›") + " " + text]);
	}

	addAssistantStart(): AssistantBuffer {
		const buffer = new AssistantBuffer();
		this.addChild(buffer);
		this.invalidate();
		return buffer;
	}

	addToolCall(name: string, args: unknown): void {
		const summary = this.formatToolCall(name, args);
		this.appendBlock([colors.cyan("· ") + colors.dim(name) + " " + summary]);
	}

	addToolResult(name: string, ok: boolean, summary: string): void {
		const icon = ok ? colors.green("✓") : colors.red("✗");
		this.appendBlock([`  ${icon} ${colors.dim(name)} ${summary}`]);
	}

	addNotice(text: string): void {
		this.appendBlock([colors.yellow("· ") + colors.dim(text)]);
	}

	addError(text: string): void {
		this.appendBlock([colors.red("error ") + text]);
	}

	private appendBlock(lines: string[]): void {
		for (const line of lines) {
			this.addChild(new Text(line, 0, 0));
		}
		this.invalidate();
	}

	private formatToolCall(name: string, args: unknown): string {
		if (!args || typeof args !== "object") return "";
		const obj = args as Record<string, unknown>;
		switch (name) {
			case "batch_computer_actions": {
				const actions = Array.isArray(obj.actions) ? obj.actions : [];
				if (actions.length === 0) return "(empty)";
				const parts = (actions as Array<Record<string, unknown>>).slice(0, 4).map(describeAction);
				const more = actions.length > 4 ? colors.dim(` +${actions.length - 4} more`) : "";
				return parts.join(colors.dim(" → ")) + more;
			}
			case "computer_use_extra": {
				const action = typeof obj.action === "string" ? obj.action : "?";
				if (action === "goto" && typeof obj.url === "string") return `goto(${obj.url})`;
				return action;
			}
			case "computer": {
				const action = typeof obj.action === "string" ? obj.action : "?";
				const c = obj.coordinate as [number, number] | undefined;
				if (Array.isArray(c) && c.length >= 2) return `${action}(${c[0]}, ${c[1]})`;
				return action;
			}
			case "click_at":
			case "hover_at":
			case "scroll_at":
			case "type_text_at":
			case "drag_and_drop":
				return colors.dim(JSON.stringify(obj));
			case "navigate":
				return typeof obj.url === "string" ? `navigate(${obj.url})` : "navigate";
			case "key_combination":
				return typeof obj.keys === "string" ? `key(${obj.keys})` : "key";
			case "go_back":
			case "go_forward":
			case "search":
			case "wait_5_seconds":
			case "open_web_browser":
			case "scroll_document":
				return "";
			case "bash":
				return colors.dim(typeof obj.command === "string" ? truncate(obj.command, 80) : "");
			case "read":
			case "write":
			case "edit":
				return colors.dim(typeof obj.path === "string" ? obj.path : "");
			default:
				return colors.dim(truncate(JSON.stringify(obj), 80));
		}
	}
}

/** Live-updating buffer for the in-flight assistant message. */
export class AssistantBuffer extends Container {
	private text = "";
	private readonly body: Text;

	constructor() {
		super();
		this.addChild(new Text(colors.green("assistant"), 0, 0));
		this.body = new Text("", 0, 0);
		this.addChild(this.body);
	}

	append(delta: string): void {
		this.text += delta;
		this.body.setText(this.text);
		this.invalidate();
	}

	end(): void {
		if (!this.text.trim()) {
			this.children = [];
		}
		this.invalidate();
	}
}

function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return text.slice(0, max - 1) + "…";
}

function describeAction(action: Record<string, unknown>): string {
	const t = typeof action.type === "string" ? action.type : "";
	const num = (v: unknown) => (typeof v === "number" ? Math.trunc(v) : 0);
	switch (t) {
		case "click":
			return `click(${num(action.x)},${num(action.y)})`;
		case "double_click":
			return `dblclick(${num(action.x)},${num(action.y)})`;
		case "triple_click":
			return `triple(${num(action.x)},${num(action.y)})`;
		case "type":
			return `type(${truncate(JSON.stringify(action.text ?? ""), 24)})`;
		case "keypress":
			return `key(${(action.keys as string[] | undefined)?.join("+") ?? ""})`;
		case "scroll":
			return `scroll(${num(action.x)},${num(action.y)})`;
		case "move":
			return `move(${num(action.x)},${num(action.y)})`;
		case "drag":
			return `drag(...)`;
		case "wait":
			return `wait(${typeof action.ms === "number" ? action.ms : 1000}ms)`;
		case "goto":
			return `goto(${typeof action.url === "string" ? action.url : ""})`;
		case "back":
			return "back";
		case "forward":
			return "forward";
		case "url":
			return "url";
		case "screenshot":
			return "screenshot";
		default:
			return t || "?";
	}
}
