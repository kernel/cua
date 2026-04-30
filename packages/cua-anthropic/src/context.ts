export function hasAnthropicCompactionBlock(message: unknown): boolean {
	if (!message || typeof message !== "object") return false;
	const content = (message as { content?: unknown }).content;
	if (!Array.isArray(content)) return false;
	return content.some((block) => Boolean(block && typeof block === "object" && (block as { type?: unknown }).type === "compaction"));
}

export function compactAnthropicMessagesForRequest<T>(messages: T[]): T[] {
	let start = -1;
	for (let i = messages.length - 1; i >= 0; i--) {
		if (hasAnthropicCompactionBlock(messages[i])) {
			start = i;
			break;
		}
	}
	return start < 0 ? messages : messages.slice(start);
}
