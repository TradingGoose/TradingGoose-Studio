const SYSTEM_FONT_STACK =
	'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"';

const isCssColorLike = (value: string): boolean => {
	const normalized = value.trim().toLowerCase();
	return (
		normalized.startsWith('#') ||
		normalized.startsWith('rgb(') ||
		normalized.startsWith('rgba(') ||
		normalized.startsWith('hsl(') ||
		normalized.startsWith('hsla(') ||
		normalized.startsWith('oklab(') ||
		normalized.startsWith('oklch(') ||
		normalized.startsWith('color(')
	);
};

const isTransparentColor = (value: string): boolean => {
	const normalized = value.trim().toLowerCase();
	return (
		normalized === '' ||
		normalized === 'transparent' ||
		normalized === 'rgba(0, 0, 0, 0)' ||
		normalized === 'rgba(0,0,0,0)'
	);
};

/**
 * Resolve the theme foreground token to a concrete CSS color string that Canvas can consume.
 */
export const resolveForegroundColorFromTheme = (): string => {
	if (typeof window === 'undefined') {
		return '#0f172a';
	}

	const root = document.documentElement;
	const styles = window.getComputedStyle(root);
	const foregroundToken = styles.getPropertyValue('--foreground').trim();

	if (foregroundToken) {
		if (isCssColorLike(foregroundToken)) {
			return foregroundToken;
		}
		// Supports token values like: "222.2 84% 4.9%"
		return `hsl(${foregroundToken})`;
	}

	const fallback = styles.color?.trim();
	return fallback || '#0f172a';
};

/**
 * Resolve the theme background token to a concrete CSS color string that Canvas can consume.
 */
export const resolveBackgroundColorFromTheme = (): string => {
	if (typeof window === 'undefined') {
		return '#0f172a';
	}

	const root = document.documentElement;
	const styles = window.getComputedStyle(root);
	const backgroundToken = styles.getPropertyValue('--background').trim();

	if (backgroundToken) {
		if (isCssColorLike(backgroundToken)) {
			return backgroundToken;
		}
		// Supports token values like: "0 0% 100%"
		return `hsl(${backgroundToken})`;
	}

	const fallback = styles.backgroundColor?.trim();
	if (fallback && !isTransparentColor(fallback)) {
		return fallback;
	}

	return '#0f172a';
};

/**
 * Enforce system fonts for draw-tool text. If tool config already provides a non-generic family,
 * it is preserved.
 */
export const resolveSystemFontFamily = (fontFamily: string | undefined): string => {
	const normalized = (fontFamily ?? '').trim();
	if (!normalized || normalized.toLowerCase() === 'sans-serif') {
		return SYSTEM_FONT_STACK;
	}
	return normalized;
};
