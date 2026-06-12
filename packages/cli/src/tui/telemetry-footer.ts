import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { colors } from "./themes";

export interface TelemetryFooterState {
	provider?: string;
	model?: string;
	thinkingLevel?: string;
	contextTokens?: number;
	contextWindow?: number;
}

export class TelemetryFooter implements Component {
	private state: TelemetryFooterState;

	constructor(initial: TelemetryFooterState) {
		this.state = initial;
	}

	update(patch: Partial<TelemetryFooterState>): void {
		this.state = { ...this.state, ...patch };
	}

	invalidate(): void {}

	render(width: number): string[] {
		const left = this.renderContextUsage();
		const right = this.renderModelInfo();

		if (!left && !right) return [" ".repeat(width)];
		if (!left) return [padToWidth(truncateToWidth(right, width), width)];
		if (!right) return [padToWidth(truncateToWidth(left, width), width)];

		const rightWidth = visibleWidth(right);
		if (rightWidth >= width) {
			return [padToWidth(truncateToWidth(right, width), width)];
		}

		const gap = 1;
		const leftMaxWidth = Math.max(1, width - rightWidth - gap);
		const leftText = truncateToWidth(left, leftMaxWidth);
		const spaces = " ".repeat(Math.max(gap, width - visibleWidth(leftText) - rightWidth));
		return [padToWidth(leftText + spaces + right, width)];
	}

	private renderContextUsage(): string {
		if (!this.state.contextWindow || this.state.contextWindow <= 0) {
			return "";
		}

		const used = Math.max(0, this.state.contextTokens ?? 0);
		const percent = this.state.contextWindow > 0 ? ((used / this.state.contextWindow) * 100).toFixed(1) : "?";
		return colors.dim(`${percent}%/${formatTokens(this.state.contextWindow)}`);
	}

	private renderModelInfo(): string {
		const modelLabel =
			this.state.provider && this.state.model ? `${this.state.provider}/${this.state.model}` : this.state.model ?? "";
		if (!modelLabel) return "";

		const thinking =
			this.state.thinkingLevel && this.state.thinkingLevel.length > 0
				? this.state.thinkingLevel === "off"
					? "thinking off"
					: this.state.thinkingLevel
				: "";
		if (!thinking) {
			return colors.dim(modelLabel);
		}
		return colors.dim(modelLabel) + colors.dim(" • ") + colors.dim(thinking);
	}
}

function formatTokens(tokens: number): string {
	if (tokens >= 1_000_000) {
		const millions = tokens / 1_000_000;
		return `${trimFraction(millions)}M`;
	}
	if (tokens >= 1_000) {
		const thousands = tokens / 1_000;
		return `${trimFraction(thousands)}K`;
	}
	return Math.round(tokens).toString();
}

function trimFraction(value: number): string {
	const rounded = value >= 10 ? value.toFixed(0) : value.toFixed(1);
	return rounded.endsWith(".0") ? rounded.slice(0, -2) : rounded;
}

function padToWidth(text: string, width: number): string {
	const pad = Math.max(0, width - visibleWidth(text));
	return text + " ".repeat(pad);
}
