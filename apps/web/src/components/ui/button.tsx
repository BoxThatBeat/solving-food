import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// shadcn/ui Button with the prototype's brutalist variants: raised accent / base buttons with a hard shadow that
// "presses" flat, an ink chip, and an underlined text button.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-sans font-extrabold cursor-pointer transition-none disabled:cursor-not-allowed disabled:opacity-55 [&_svg]:shrink-0 [&_svg]:size-[1.1em]",
  {
    variants: {
      variant: {
        primary: "bg-acc text-onc border-bw rounded-ui shadow-hard press",
        secondary: "bg-base text-ink border-bw rounded-ui shadow-hard press",
        chip: "bg-base text-ink border-2 border-line rounded-ui shadow-hard-sm",
        ink: "bg-ink text-base border-2 border-line rounded-ui",
        ghost: "bg-transparent text-ink border-0 underline underline-offset-2",
      },
      size: {
        default: "px-4 py-3 text-[0.9375rem]",
        lg: "px-4 py-[0.9375rem] text-base",
        sm: "px-2.5 py-2 text-[0.8125rem]",
        icon: "size-[2.375rem] p-0 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

// eslint-disable-next-line react-refresh/only-export-components
export { buttonVariants };
