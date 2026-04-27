/**
 * OpenAI computer-use system-prompt preamble for the batch_computer_actions /
 * computer_use_extra tool surface.
 *
 * Why a preamble at all? OpenAI's computer-use documentation tells the model
 * how the native `computer` tool works, but we register custom function
 * tools instead (see `./official.ts` for why). The preamble teaches the
 * model how to use our function tools, when to prefer batched actions,
 * and how to read intermediate state via `url()` and `screenshot()` reads
 * embedded in a batch.
 */

export const OPENAI_BATCH_INSTRUCTIONS = `You have two ways to perform actions:
1. batch_computer_actions — the primary tool for browser interaction. Use it for click, double_click, type, keypress, scroll, move, drag, wait, goto, back, url, and screenshot whenever possible.
2. computer_use_extra — convenience wrapper for high-level browser actions: goto, back, and url.

ALWAYS prefer batch_computer_actions when performing predictable sequences like:
- Clicking a text field, typing text, and pressing Enter
- Typing a URL and pressing Enter
- Dragging an item from one location to another using a drag path
- Any sequence where you want to mix writes with explicit url() or screenshot() readbacks

Drag planning rules:
- If one drag is likely to change the position, order, or layout of other targets, do not batch multiple drags together.
- In those cases, perform one drag at a time and inspect the updated screenshot before planning the next drag.

Use explicit url() and screenshot() steps inside batch_computer_actions whenever you need
intermediate readbacks. If you do not include explicit read steps, the batch
tool still returns one fresh screenshot after execution.
Do not request screenshot-only batches repeatedly. Use screenshot() exactly
where you need an updated view, especially after waiting or another
asynchronous UI change.

When navigating long pages or lists, STRONGLY prefer keyboard navigation with
Page_Down, Page_Up, Home, and End before using mouse-wheel scrolling. For
small adjustments, prefer Up and Down arrow keys before using mouse-wheel
scrolling. Use mouse-wheel scrolling only when keyboard navigation does not
affect the specific container you need to move.

Use computer_use_extra for:
- action="goto" with url to navigate via keyboard-only browser navigation
- action="back" to go back in history
- action="url" to read the exact current URL`;

export const OPENAI_NATIVE_COMPUTER_INSTRUCTIONS = `You control a cloud browser through OpenAI's built-in computer tool.

Use the computer tool to inspect the current page, click targets, type text,
press keys, scroll, and navigate.

When interacting with inputs and forms:
- Click to focus before typing.
- Use keyboard navigation for predictable address-bar navigation.

When navigating long pages or lists, STRONGLY prefer keyboard navigation with
Page_Down, Page_Up, Home, and End before using mouse-wheel scrolling. For
small adjustments, prefer Up and Down arrow keys before using mouse-wheel
scrolling. Use mouse-wheel scrolling only when keyboard navigation does not
affect the specific container you need to move.

Verify results after actions that may change the page state.`;
