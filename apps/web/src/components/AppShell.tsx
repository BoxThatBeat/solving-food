// <AppShell>: bottom tab bar (phone) → collapsible side rail (md) → persistent side nav (lg) (TECHNICAL_SPECS §12).
// Shapes follow the prototype: ink wordmark, household chip/button, accent-filled active item with a hard shadow.

import * as React from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { collection, doc } from "firebase/firestore";
import { ChevronDown, ChevronsLeft, ChevronsRight } from "lucide-react";
import { PAGES, type NavPage } from "./nav";
import type { MemberDoc } from "@solving-food/core";
import { db } from "@/firebase/app";
import { useLiveDoc, useLiveQuery } from "@/data/live";
import { useActiveHousehold } from "@/data/households";
import { InviteBanner } from "./households/Invites";
import { consumeSelfLeft } from "./households/removal";
import { useNotify } from "./notifications-context";
import { isPublicPath } from "@/session/publicPaths";
import { useReadySession, useSession } from "@/session/useSession";
import { reportServerContact, useOnline } from "@/hooks/useOnline";
import { cn } from "@/lib/utils";
import { ListenerErrorBanner, NotificationBanners, NotificationFeed, UpdateBanner } from "./notifications";
import { useRecipeIndex } from "@/search/useRecipeSearch";
import { HouseholdSheet } from "./HouseholdSheet";
import { Sheet, SheetContent, SheetTrigger, SheetClose } from "./ui/sheet";
import { Wordmark } from "./Wordmark";
import { PlanSheetProvider } from "./plan/PlanSheetProvider";
import { SuggestionsProvider } from "./SuggestionsProvider";
import { NutritionContext, nutritionOf } from "@/data/nutrition";
import { useMeals } from "@/data/plan";
import { usePlanModel } from "@/data/planModel";
import { usePendingReviews } from "./cook/helpers";
import { itemExpiry } from "./supply/format";
import { PlanModelProvider } from "./PlanModelProvider";
import { useMediaQuery } from "@/hooks/useMediaQuery";

/** The shell's breakpoints (index.css): md 48rem rail, lg 64rem side nav. */
const MD_UP = "(min-width: 48rem)";
const LG_UP = "(min-width: 64rem)";

/** Supply items expiring soon or expired (the prototype's "3 SOON" beside Supply), from the shared plan model. */
function useSoonCount(): number {
  const m = usePlanModel();
  const tz = m.household?.timezone ?? "America/Toronto";
  return React.useMemo(() => {
    let n = 0;
    for (const it of m.supply.items.values()) {
      if (!it.lots.length) continue;
      const f = itemExpiry(it.lots, m.supply.now, tz).flag;
      if (f === "soon" || f === "expired") n++;
    }
    return n;
  }, [m.supply.items, m.supply.now, tz]);
}

const page = (to: NavPage["to"]) => PAGES.find((p) => p.to === to)!;
const MORE_PAGES = [page("/meals"), page("/history"), page("/settings")];
/** Not a main page (PRD §12): reached from More on phones and from Settings everywhere (M8). */
const INGREDIENTS_PAGE = { to: "/ingredients", label: "Ingredients", sub: "Catalogue, names and conversions" } as const;

function usePathname(): string {
  return useRouterState({ select: (s) => s.location.pathname });
}

function isActive(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`);
}

function useHouseholdSummary() {
  const hh = useActiveHousehold();
  const members = useLiveQuery<MemberDoc>(
    collection(db, "households", hh.id, "members"),
    `households/${hh.id}/members`,
  );
  return {
    name: hh.data?.name ?? "",
    memberNames: (members.docs ?? []).map((m) => m.data.displayName),
  };
}

/** Feeds the connectivity store (hooks/useOnline.ts) from the household document's cache/server metadata. */
function ConnectivityProbe({ hid }: { hid: string }) {
  const probe = useLiveDoc(doc(db, "households", hid), `households/${hid}#probe`, { metadata: true });
  const fromCache = probe.data === undefined ? null : probe.fromCache;
  React.useEffect(() => {
    if (fromCache !== null) reportServerContact(fromCache);
  }, [fromCache]);
  React.useEffect(() => () => reportServerContact(false), []);
  return null;
}

function SyncStatus() {
  const online = useOnline();
  return (
    <span className="flex items-center gap-1.5 font-mono text-[0.65625rem] font-bold">
      <span aria-hidden className={cn("size-2 border-[1.5px] border-line", online ? "bg-[#a6da95]" : "bg-peach")} />
      {online ? "SYNCED" : "OFFLINE · CHANGES QUEUED"}
    </span>
  );
}

// ---------- phone

/** Phones have no side navigation (M23 mounts one navigation per width), so the header says when the app is offline. */
function PhoneOffline() {
  const online = useOnline();
  if (online) return null;
  return (
    <span role="status" className="flex items-center gap-1 rounded-ui border-2 border-line bg-peach px-1.5 py-0.5 font-mono text-[0.625rem] font-bold text-onc" data-testid="phone-offline">
      OFFLINE
    </span>
  );
}

function PhoneHeader() {
  const { name, memberNames } = useHouseholdSummary();
  return (
    <header className="flex flex-none items-center justify-between gap-2 px-4 pt-[max(0.375rem,env(safe-area-inset-top))] pb-2">
      <Wordmark />
      <PhoneOffline />
      <HouseholdSheet>
        <SheetTrigger
          className="min-h-11 cursor-pointer whitespace-nowrap rounded-ui border-2 border-line bg-base px-2.5 py-2 font-mono text-[0.6875rem] font-bold text-ink uppercase shadow-hard-sm"
          aria-label={`Household: ${name}. Switch household`}
        >
          <span className="inline-flex items-center gap-1">
            {name} · {memberNames.length || 1}
            <ChevronDown aria-hidden className="size-3.5" strokeWidth={3} />
          </span>
        </SheetTrigger>
      </HouseholdSheet>
    </header>
  );
}

const tabClass = (on: boolean) =>
  cn(
    "relative flex min-h-11 min-w-0 flex-1 cursor-pointer items-center justify-center rounded-ui border-2 py-3 text-[0.78125rem] font-extrabold no-underline",
    on ? "border-line bg-acc text-onc shadow-hard-sm" : "border-transparent bg-transparent text-ink",
  );

function TabBar() {
  const pathname = usePathname();
  const moreOn = ["/meals", "/history", "/settings", "/ingredients"].some((p) => isActive(pathname, p));
  const tabs = [page("/plan"), page("/recipes"), page("/supply"), page("/grocery")];
  return (
    <nav
      aria-label="Primary"
      data-nav="tabs"
      className="sticky bottom-0 z-20 flex flex-none gap-1 border-t-bw bg-base px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden"
    >
      {tabs.map((p) => {
        const on = isActive(pathname, p.to);
        return (
          <Link key={p.to} to={p.to} className={tabClass(on)} aria-current={on ? "page" : undefined}>
            {p.label}
          </Link>
        );
      })}
      <Sheet>
        <SheetTrigger className={tabClass(moreOn)} aria-label="More pages">
          More
        </SheetTrigger>
        <SheetContent title="More">
          {[...MORE_PAGES, INGREDIENTS_PAGE].map((p) => (
            <SheetClose asChild key={p.to}>
              <Link
                to={p.to}
                className="flex items-center justify-between rounded-ui border-bw bg-base p-3.5 text-ink no-underline shadow-hard"
              >
                <span className="flex flex-col gap-1">
                  <span className="text-lg font-extrabold">{p.label}</span>
                  <span className="text-xs font-semibold text-sub">
                    {p.sub}
                  </span>
                </span>
                <span aria-hidden className="text-lg font-extrabold">
                  →
                </span>
              </Link>
            </SheetClose>
          ))}
        </SheetContent>
      </Sheet>
    </nav>
  );
}

// ---------- tablet rail and desktop side nav

function HouseholdButton({ compact }: { compact?: boolean }) {
  const { name, memberNames } = useHouseholdSummary();
  return (
    <HouseholdSheet>
      <SheetTrigger
        aria-label={`Household: ${name}. Switch household`}
        className={cn(
          "flex cursor-pointer flex-col gap-0.5 rounded-ui border-2 border-line bg-pg text-left text-ink shadow-hard-sm",
          compact ? "items-center p-2" : "px-2.5 py-2",
        )}
      >
        {compact ? (
          <span className="font-display text-sm">{name.slice(0, 2).toUpperCase()}</span>
        ) : (
          <>
            <span className="font-mono text-[0.59375rem] font-bold tracking-[0.0625rem] text-sub">HOUSEHOLD</span>
            <span className="flex items-center gap-1 text-[0.9375rem] font-extrabold">
              {name}
              <ChevronDown aria-hidden className="size-3.5" strokeWidth={3} />
            </span>
            <span className="font-mono text-[0.65625rem] font-semibold uppercase">{memberNames.join(" · ")}</span>
          </>
        )}
      </SheetTrigger>
    </HouseholdSheet>
  );
}

function NavList({ compact }: { compact?: boolean }) {
  const pathname = usePathname();
  // Counts beside nav items, as in the prototype: meals to cook this period, recipes, saved meals. M23: read from the
  // shell's shared plan model and the pages' own listeners; mounted only on tablets and desktops, where they show.
  const recipeCount = useRecipeIndex()?.length;
  const m = usePlanModel();
  const planned = m.loading ? undefined : m.items.filter((d) => d.data.status === "planned").length;
  const meals = useMeals().docs?.length;
  const s = useReadySession();
  const toRate = usePendingReviews(m.hid, s.user.uid).length;
  const soon = useSoonCount();
  const counts: Partial<Record<NavPage["to"], number | string | undefined>> = {
    "/plan": planned,
    "/recipes": recipeCount,
    "/meals": meals,
    "/supply": soon ? `${soon} SOON` : undefined,
    "/history": toRate ? `${toRate} TO RATE` : undefined,
  };
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
      {PAGES.map((p) => {
        const on = isActive(pathname, p.to);
        const Icon = p.icon;
        return (
          <li key={p.to}>
            <Link
              to={p.to}
              aria-current={on ? "page" : undefined}
              aria-label={compact ? p.label : undefined}
              title={compact ? p.label : undefined}
              className={cn(
                "flex items-center gap-2 rounded-ui border-2 text-[0.9375rem] font-extrabold no-underline",
                compact ? "justify-center p-2.5" : "justify-between px-3 py-2.5",
                on ? "border-line bg-acc text-onc shadow-hard-sm" : "border-transparent bg-transparent text-ink",
              )}
            >
              {compact ? (
                <Icon aria-hidden className="size-5" strokeWidth={2.5} />
              ) : (
                <>
                  <span>{p.label}</span>
                  {counts[p.to] ? (
                    <span className="font-mono text-[0.6875rem] font-bold" data-testid="nav-count">
                      {counts[p.to]}
                    </span>
                  ) : null}
                </>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

const RAIL_KEY = "sf.rail";

function SideRail() {
  const [collapsed, setCollapsed] = React.useState(() => {
    try {
      return localStorage.getItem(RAIL_KEY) === "collapsed";
    } catch {
      return false;
    }
  });
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(RAIL_KEY, c ? "expanded" : "collapsed");
      } catch {
        /* ignore */
      }
      return !c;
    });
  };
  return (
    <nav
      aria-label="Primary"
      data-nav="rail"
      data-collapsed={collapsed || undefined}
      className={cn(
        "sticky top-0 hidden h-dvh flex-none flex-col gap-4 overflow-y-auto border-r-bw bg-base py-4 md:flex lg:hidden",
        collapsed ? "w-[4.75rem] px-2.5" : "w-[11rem] px-3",
      )}
    >
      <div className={cn("flex items-start gap-2", collapsed ? "flex-col items-center" : "justify-between")}>
        {collapsed ? <Wordmark compact /> : <Wordmark stacked size="sm" />}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          aria-expanded={!collapsed}
          className="grid size-8 flex-none cursor-pointer place-items-center rounded-ui border-2 border-line bg-base text-ink"
        >
          {collapsed ? (
            <ChevronsRight aria-hidden className="size-4" strokeWidth={3} />
          ) : (
            <ChevronsLeft aria-hidden className="size-4" strokeWidth={3} />
          )}
        </button>
      </div>
      <HouseholdButton compact={collapsed} />
      <NavList compact={collapsed} />
      {collapsed ? null : (
        <div className="mt-auto">
          <SyncStatus />
        </div>
      )}
    </nav>
  );
}

function SideNav() {
  const s = useReadySession();
  return (
    <nav
      aria-label="Primary"
      data-nav="sidebar"
      className="sticky top-0 hidden h-dvh w-[13.75rem] flex-none flex-col gap-4 overflow-y-auto border-r-bw bg-base px-3.5 py-[1.125rem] lg:flex 3xl:w-[15rem]"
    >
      <Wordmark stacked />
      <HouseholdButton />
      <NavList />
      <div className="mt-auto flex flex-col gap-1.5 font-mono text-[0.65625rem] font-bold">
        <SyncStatus />
        <span className="uppercase">Signed in as {s.displayName}</span>
      </div>
    </nav>
  );
}

/** Signed-out (or not yet set up) visitors on a shared recipe page: the wordmark and a sign-in link, no navigation. */
function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-pg text-ink">
      <header className="flex flex-none items-center justify-between gap-2 border-b-bw bg-base px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 md:px-7">
        <Link to="/" aria-label="Solving Food" className="no-underline">
          <Wordmark />
        </Link>
        <Link
          to="/sign-in"
          className="rounded-ui border-2 border-line bg-base px-3 py-2 text-[0.8125rem] font-extrabold text-ink no-underline shadow-hard-sm"
        >
          Sign in
        </Link>
      </header>
      <main id="main" className="min-w-0 flex-1">
        {children}
      </main>
      <NotificationBanners className="bottom-6" />
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const pathname = usePathname();
  if (session.status !== "ready") {
    // Left or removed from the last household (or signed out elsewhere): the route guard is about to redirect; pages
    // inside the shell need a ready session, so render nothing meanwhile.
    if (!isPublicPath(pathname)) return null;
    return <PublicShell>{children}</PublicShell>;
  }
  return <ReadyShell uid={session.user.uid}>{children}</ReadyShell>;
}

/** "You're no longer in X": the active household dropped out of my memberships (removed by someone, R2.5). */
function RemovalNotice() {
  const s = useReadySession();
  const hh = useActiveHousehold();
  const notify = useNotify();
  const prev = React.useRef<{ id: string; name: string } | null>(null);
  React.useEffect(() => {
    const p = prev.current;
    if (p && p.id !== s.activeHouseholdId && !s.householdIds.includes(p.id) && !consumeSelfLeft(p.id)) {
      notify({ kind: "info", message: p.name ? `You're no longer a member of ${p.name}.` : "You're no longer a member of that household." });
    }
    prev.current = { id: s.activeHouseholdId, name: hh.data?.name ?? (p?.id === s.activeHouseholdId ? p.name : "") };
  }, [s.activeHouseholdId, s.householdIds, hh.data?.name, notify]);
  return null;
}

/** Nutrition tracking (M9, R6.27) and goals from the active household, for every page in the shell. */
function NutritionProvider({ children }: { children: React.ReactNode }) {
  const hh = useActiveHousehold();
  const settings = hh.data?.settings;
  const value = React.useMemo(() => nutritionOf(settings), [settings]);
  return <NutritionContext.Provider value={value}>{children}</NutritionContext.Provider>;
}

function ReadyShell({ children, uid }: { children: React.ReactNode; uid: string }) {
  const s = useReadySession();
  const pathname = usePathname();
  // M23: only the navigation for this width is mounted (each variant's badges open listeners).
  const md = useMediaQuery(MD_UP);
  const lg = useMediaQuery(LG_UP);
  return (
    <NutritionProvider>
    <PlanModelProvider>
    <SuggestionsProvider>
    <PlanSheetProvider>
    <div className="flex min-h-dvh bg-pg text-ink">
      {lg ? <SideNav /> : md ? <SideRail /> : null}
      <div className="flex min-w-0 flex-1 flex-col">
        {md ? null : (
          <div className="md:hidden">
            <PhoneHeader />
          </div>
        )}
        {pathname === "/settings/account" ? null : <InviteBanner me={{ uid: s.user.uid, email: s.user.email, displayName: s.displayName }} householdIds={s.householdIds} />}
        <main id="main" className="min-w-0 flex-1">
          {children}
        </main>
        {md ? null : <TabBar />}
      </div>
      <NotificationFeed uid={uid} />
      <ListenerErrorBanner householdIds={s.householdIds} />
      <ConnectivityProbe hid={s.activeHouseholdId} />
      <RemovalNotice />
      <UpdateBanner />
      <NotificationBanners className="bottom-[calc(5.75rem+env(safe-area-inset-bottom))] md:bottom-7" />
    </div>
    </PlanSheetProvider>
    </SuggestionsProvider>
    </PlanModelProvider>
    </NutritionProvider>
  );
}

/** Kicker + Archivo Black title, as every prototype page header. */
export function PageHeader({ title, kicker, children }: { title: string; kicker?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2.5">
      <div className="flex flex-col gap-1">
        {kicker ? <span className="kicker">{kicker}</span> : null}
        <h1 className="m-0 font-display text-[2.25rem] leading-[0.95] font-normal">{title}</h1>
      </div>
      {children}
    </div>
  );
}

/** Page body with the prototype's padding (phone 4/16/28 px, wide 22/28/40 px) and a max width. */
export function PageBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "mx-auto box-border flex w-full max-w-[93.75rem] flex-col gap-3.5 px-4 pt-1 pb-7 md:px-7 md:pt-[1.375rem] md:pb-10",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-ui border-2 border-dashed border-line p-[1.375rem] text-center text-sm font-bold">
      {children}
    </div>
  );
}

