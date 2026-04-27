/**
 * Scroll-delta math.
 *
 * Models that emit pixel-style scroll deltas (OpenAI computer-use, where one
 * mouse wheel "tick" is conventionally 120 pixels) call
 * {@link modelScrollDeltaToWheelTicks} to convert their pixel value into
 * the wheel-notch count Kernel's `browsers.computer.scroll` API wants.
 *
 * Models that emit a scroll-amount (Anthropic, Gemini) can call
 * {@link wheelTicksFromAmount} to feed the same end-point in canonical
 * units. Direction is the caller's responsibility; this helper only sizes.
 */

const PIXELS_PER_TICK = 120;

/**
 * Convert a model-emitted pixel delta into wheel-notch count for the Kernel
 * scroll endpoint. Sign is preserved. A non-zero magnitude always rounds to
 * at least 1 tick so a small pixel value still scrolls.
 */
export function modelScrollDeltaToWheelTicks(delta: number): number {
	if (!Number.isFinite(delta) || delta === 0) return 0;
	const sign = delta < 0 ? -1 : 1;
	const magnitude = Math.abs(delta);
	const ticks = Math.max(1, Math.round(magnitude / PIXELS_PER_TICK));
	return sign * ticks;
}

/**
 * Convert a click/notch count (positive integer) into Kernel wheel-notch
 * count. Useful for providers (Anthropic, Gemini) whose scroll actions
 * specify N "clicks" rather than pixels.
 */
export function wheelTicksFromAmount(amount: number): number {
	if (!Number.isFinite(amount) || amount <= 0) return 0;
	return Math.max(1, Math.trunc(amount));
}
