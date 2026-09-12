import Image from "next/image";
import { preload } from "react-dom";

import { rawImage } from "@/templates/raw-image";

/** How wide the picture is on screen: the storefront column, or the whole
 *  viewport on a phone. Shared by every full-width picture the templates
 *  show, so the browser's srcset choice is the same for all of them. */
export const COLUMN_SIZES = "(max-width: 560px) 100vw, 560px";

/**
 * A picture the store uploaded, at the size the screen needs.
 *
 * With `srcSet` (the API's resized WebP copies, api/media.py) this is a plain
 * <picture>: the browser picks the copy nearest its width × pixel ratio, with
 * the untouched original as the fallback — nothing is re-encoded on the way.
 * Above the fold (`priority`) it is also preloaded at high fetch priority,
 * so the LCP image starts downloading with the HTML rather than after the
 * CSS. Without copies (a small upload, a template default from /public) it
 * goes through next/image as before.
 */
export function ProductPicture({
  src,
  srcSet,
  width,
  height,
  alt,
  sizes = COLUMN_SIZES,
  priority = false,
  className,
}: {
  src: string;
  srcSet?: string | null;
  width: number;
  height: number;
  alt: string;
  sizes?: string;
  priority?: boolean;
  className?: string;
}) {
  if (!srcSet) {
    return (
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        sizes={sizes}
        priority={priority}
        fetchPriority={priority ? "high" : undefined}
        unoptimized={rawImage(src)}
        className={className}
      />
    );
  }
  if (priority) {
    preload(src, {
      as: "image",
      imageSrcSet: srcSet,
      imageSizes: sizes,
      type: "image/webp",
      fetchPriority: "high",
    });
  }
  return (
    <picture>
      <source type="image/webp" srcSet={srcSet} sizes={sizes} />
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        sizes={sizes}
        decoding="async"
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        className={className}
      />
    </picture>
  );
}
