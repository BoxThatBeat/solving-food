import * as React from "react";
import { NotificationBanners } from "./notifications";
import { Wordmark } from "./Wordmark";

/** Centred single-card layout for sign-in and first-run pages, in the prototype's tokens. */
export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center bg-pg px-4 pt-[max(2.5rem,env(safe-area-inset-top))] pb-10 text-ink md:justify-center md:pt-10">
      <main className="flex w-full max-w-[28rem] flex-col gap-6">
        <Wordmark stacked size="lg" />
        {children}
      </main>
      <NotificationBanners className="bottom-7" />
    </div>
  );
}

export function FieldError({ id, children }: { id: string; children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="m-0 text-[0.8125rem] font-bold text-ink">
      <span className="mr-1.5 inline-block rounded-[3px] border-[1.5px] border-line bg-red px-1 font-mono text-[0.625rem]">!</span>
      {children}
    </p>
  );
}
