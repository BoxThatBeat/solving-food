import * as React from "react";
import { cn } from "@/lib/utils";

/** Raised panel: base background, look-weight border, hard shadow. */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("bg-base text-ink border-bw rounded-ui shadow-hard p-3.5 flex flex-col gap-2.5", className)} {...props} />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("m-0 font-display font-normal text-[1.1875rem] leading-tight", className)} {...props} />;
}
