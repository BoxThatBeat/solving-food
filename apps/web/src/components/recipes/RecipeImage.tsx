// Recipe images: three stored WebP sizes served with srcset/sizes (spec §12 "Sharp images"); without an image, the
// prototype's diagonal stripes tinted by cuisine.
import { imageVariant } from "@solving-food/core";
import { publicUrl } from "@/firebase/app";
import { cn } from "@/lib/utils";
import { srcSetFor, stripes } from "./helpers";

export function RecipeImage({
  base,
  cuisine,
  alt,
  sizes,
  className,
  eager,
}: {
  base: string | null | undefined;
  cuisine: string;
  alt: string;
  sizes: string;
  className?: string;
  eager?: boolean;
}) {
  if (!base) {
    // Decorative (alt ""): the placeholder stripes say nothing to a screen reader.
    if (!alt) return <div aria-hidden className={cn("size-full", className)} style={{ background: stripes(cuisine) }} />;
    return <div role="img" aria-label={`${alt} (no photo)`} className={cn("size-full", className)} style={{ background: stripes(cuisine) }} />;
  }
  return (
    <img
      src={publicUrl(imageVariant(base, 960))}
      srcSet={srcSetFor(base)}
      sizes={sizes}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      className={cn("size-full object-cover", className)}
      style={{ background: stripes(cuisine) }}
    />
  );
}
