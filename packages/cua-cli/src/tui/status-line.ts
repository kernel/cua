import { Text, hyperlink } from "@mariozechner/pi-tui";
import { colors } from "./themes.js";

export interface StatusLineState {
	model: string;
	browserSession?: string;
	liveUrl?: string;
	currentUrl?: string;
	cost?: number;
	tokens?: number;
	working?: string;
}

export class StatusLine extends Text {
	private state: StatusLineState;

	constructor(initial: StatusLineState) {
		super("", 0, 0);
		this.state = initial;
		this.refresh();
	}

	update(patch: Partial<StatusLineState>): void {
		this.state = { ...this.state, ...patch };
		this.refresh();
	}

	private refresh(): void {
		const sep = colors.dim(" · ");
		const parts: string[] = [colors.bold("cua")];
		if (this.state.liveUrl) {
			parts.push(colors.dim("browser ") + hyperlink(this.state.liveUrl, this.state.liveUrl));
		} else if (this.state.browserSession) {
			parts.push(colors.dim("browser ") + this.state.browserSession.slice(0, 6) + "…");
		}
		if (this.state.currentUrl) parts.push(colors.dim("url ") + truncate(this.state.currentUrl, 50));
		if (this.state.tokens !== undefined) parts.push(colors.dim("tokens ") + this.state.tokens.toLocaleString());
		if (this.state.cost !== undefined) parts.push(colors.dim("$") + this.state.cost.toFixed(3));
		if (this.state.working) parts.push(colors.yellow(`⏳ ${this.state.working}`));
		this.setText(parts.join(sep));
	}
}

function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return text.slice(0, max - 1) + "…";
}
