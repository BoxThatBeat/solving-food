import { cn } from "@/lib/utils";

/** The prototype's mark: "SOLVING FOOD" in Archivo Black, base on ink, tilted by the look's --tilt. */
export function Wordmark({
  stacked,
  compact,
  size = "md",
  className,
}: {
  stacked?: boolean;
  compact?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const text = compact ? (
    <>
      S<br />F
    </>
  ) : stacked ? (
    <>
      SOLVING
      <br />
      FOOD
    </>
  ) : (
    "SOLVING FOOD"
  );
  return (
    <span
      role="img"
      aria-label="Solving Food"
      className={cn(
        "inline-block self-start whitespace-nowrap rounded-ui bg-ink font-display font-normal tracking-[0.03125rem] text-base [transform:rotate(var(--tilt))]",
        size === "sm" && "px-2 pt-1.5 pb-1 text-[0.9375rem] leading-[1.05]",
        size === "md" && (stacked ? "px-2.5 pt-[0.4375rem] pb-1.5 text-[1.1875rem] leading-[1.05]" : "px-[0.5625rem] pt-1.5 pb-[0.3125rem] text-[1.0625rem] leading-none"),
        size === "lg" && "px-3.5 pt-2.5 pb-2 text-[2rem] leading-[1.02]",
        className,
      )}
    >
      {text}
    </span>
  );
}
