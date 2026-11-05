// Colour helpers for templates whose colours a store picks (catalog
// ColorField values, always "#rrggbb" by the time a template sees them).

/** Whether "#rrggbb" is light enough to want dark text (WCAG luminance). */
export function isLight(hex: string): boolean {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.4;
}
