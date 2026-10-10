import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "@/lib/utils";

/** Mono, letter-spaced field label, as the prototype's section labels. */
export function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn("font-mono font-bold text-[0.6875rem] tracking-[0.09rem] uppercase", className)}
      {...props}
    />
  );
}
