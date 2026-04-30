const TZAFON_COMPUTER_INSTRUCTIONS = `Use a mouse and keyboard to interact with a Chromium browser and take screenshots.
* Chromium is already open on a Kernel cloud browser. If a startup wizard appears, ignore it.
* The screen's coordinate space is a 0-999 grid.
* To navigate to a URL, use point_and_type on the address bar, or key("ctrl+l") to focus it first.
* Some pages may take time to load. Wait and take successive screenshots to confirm the result.
* Whenever you click on an element, consult the screenshot to determine coordinates first.
* Click buttons, links, and icons in the center of the element, not on edges.
* If a click did not work, try adjusting the coordinates slightly.
* For full-page scrolling, prefer key("PageDown") / key("PageUp") over the scroll tool.
* After each action, evaluate the screenshot to confirm it succeeded before moving on.
* When the task is complete, call done() with a summary of what you found or accomplished.`;

export interface TzafonSystemPromptOptions {
	suffix?: string;
}

export function buildTzafonSystemPrompt(opts: TzafonSystemPromptOptions = {}): string {
	const suffix = (opts.suffix ?? "").trim();
	if (!suffix) return TZAFON_COMPUTER_INSTRUCTIONS;
	return `${TZAFON_COMPUTER_INSTRUCTIONS}\n\n${suffix}`;
}

export const TZAFON_INSTRUCTIONS_RAW = {
	computer: TZAFON_COMPUTER_INSTRUCTIONS,
};
