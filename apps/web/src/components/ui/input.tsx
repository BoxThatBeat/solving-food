import * as React from "react";
import { cn } from "@/lib/utils";

/** The prototype's search/text input: base background, look-weight border, hard shadow. */
export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full min-w-0 box-border bg-base text-ink border-bw rounded-ui shadow-hard px-3.5 py-3 font-sans font-semibold text-[0.9375rem] pointer-coarse:text-[1rem] outline-none focus-visible:outline-[0.1875rem] focus-visible:outline-ink focus-visible:outline-offset-2 aria-invalid:border-red",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "w-full min-w-0 box-border bg-base text-ink border-bw rounded-ui shadow-hard px-3 py-3 font-sans font-semibold text-[0.9375rem] pointer-coarse:text-[1rem]",
        className,
      )}
      {...props}
    />
  );
}
