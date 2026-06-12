import { Container, Image, allocateImageId } from "@earendil-works/pi-tui";
import { imageTheme } from "./themes";

const MAX_WIDTH_CELLS = 60;

/**
 * Sticky screenshot widget that re-renders the latest tool screenshot
 * inline using pi-tui's terminal-image (Kitty / iTerm2). Falls back to
 * a compact text card on terminals without inline image support.
 */
export class ScreenshotWidget extends Container {
	private readonly imageId = allocateImageId();

	clear(): void {
		this.children = [];
		this.invalidate();
	}

	update(pngBase64: string, mimeType = "image/png"): void {
		const image = new Image(pngBase64, mimeType, imageTheme, {
			maxWidthCells: MAX_WIDTH_CELLS,
			imageId: this.imageId,
		});
		this.children = [image];
		this.invalidate();
	}
}
