import {
	Container,
	type Component,
	allocateImageId,
	getImageDimensions,
	imageFallback,
	renderImage,
	type ImageDimensions,
	type ImageTheme,
} from "@mariozechner/pi-tui";
import { imageTheme } from "./themes.js";

const MAX_WIDTH_CELLS = 60;

/**
 * Sticky screenshot widget that re-renders the latest tool screenshot
 * inline using pi-tui's terminal-image (Kitty / iTerm2). Falls back to
 * a compact text card on terminals without inline image support.
 */
export class ScreenshotWidget extends Container {
	private currentImage?: StableInlineImage;
	private readonly imageId = allocateImageId();

	constructor() {
		super();
	}

	clear(): void {
		this.children = [];
		this.currentImage = undefined;
		this.invalidate();
	}

	update(pngBase64: string, mimeType = "image/png"): void {
		const dims = getImageDimensions(pngBase64, mimeType);
		this.currentImage = new StableInlineImage(
			pngBase64,
			mimeType,
			imageTheme,
			{
				imageId: this.imageId,
			},
			dims ?? undefined,
		);
		this.children = [this.currentImage];
		this.invalidate();
	}
}

interface StableInlineImageOptions {
	imageId?: number;
}

/**
 * `pi-tui`'s stock Image component prepends a cursor-up sequence before the
 * Kitty payload, but it does not restore the cursor afterwards. In a
 * differential renderer that keeps issuing relative cursor moves, that causes
 * the terminal cursor to drift upward after image updates. This wrapper keeps
 * the same logical row accounting while restoring the cursor after drawing.
 */
class StableInlineImage implements Component {
	private readonly dimensions: ImageDimensions;
	private imageId?: number;
	private cachedLines?: string[];
	private cachedWidth?: number;

	constructor(
		private readonly base64Data: string,
		private readonly mimeType: string,
		private readonly theme: ImageTheme,
		options: StableInlineImageOptions = {},
		dimensions?: ImageDimensions,
	) {
		this.imageId = options.imageId;
		this.dimensions = dimensions || getImageDimensions(base64Data, mimeType) || { widthPx: 800, heightPx: 600 };
	}

	invalidate(): void {
		this.cachedLines = undefined;
		this.cachedWidth = undefined;
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) {
			return this.cachedLines;
		}

		const maxWidth = Math.min(width - 2, MAX_WIDTH_CELLS);
		const result = renderImage(this.base64Data, this.dimensions, {
			maxWidthCells: maxWidth,
			imageId: this.imageId,
		});

		let lines: string[];
		if (result) {
			if (result.imageId) {
				this.imageId = result.imageId;
			}
			lines = [];
			for (let i = 0; i < result.rows - 1; i++) {
				lines.push("");
			}
			const moveUp = result.rows > 1 ? `\x1b[${result.rows - 1}A` : "";
			const saveCursor = "\x1b7";
			const restoreCursor = "\x1b8";
			lines.push(saveCursor + moveUp + result.sequence + restoreCursor);
		} else {
			lines = [this.theme.fallbackColor(imageFallback(this.mimeType, this.dimensions))];
		}

		this.cachedLines = lines;
		this.cachedWidth = width;
		return lines;
	}
}
