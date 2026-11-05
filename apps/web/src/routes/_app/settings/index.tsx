// Settings (PRD R11.16 groups, R11.17 search, R11.18 Account and invites; TECHNICAL_SPECS §12 Routes). M20: the
// sections sit under five group headings (side by side as columns on wide screens, stacked on phones), with a search
// box above that filters them by name, description and the keywords for what's inside each page. Account (sign out,
// invites) is its own page; open invites show as the shell's banner at the top of this page.
import * as React from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_app/settings/")({
  component: SettingsPage,
});

type SettingsPath =
  | "/settings/household"
  | "/settings/members"
  | "/settings/preferences"
  | "/settings/nutrition"
  | "/settings/sides"
  | "/settings/tools"
  | "/settings/weights"
  | "/settings/stores"
  | "/settings/brands"
  | "/ingredients"
  | "/settings/gemini"
  | "/settings/account"
  | "/settings/theme"
  | "/settings/data";

interface Section {
  to: SettingsPath;
  label: string;
  sub: string;
  /** What the page holds beyond its name and description: card titles, fields, and words people search for. */
  keywords: readonly string[];
}

/** Every Settings section, in its group. The search (R11.17) reads `label`, `sub` and `keywords`; keep them here. */
const SETTINGS_GROUPS: ReadonlyArray<{ id: string; label: string; sections: readonly Section[] }> = [
  {
    id: "household",
    label: "Household",
    sections: [
      {
        to: "/settings/household",
        label: "Household",
        sub: "Period, budget, timezone, servings, meal types",
        keywords: ["name", "rename", "plan period", "length", "days", "restart period", "money", "spend", "dollars", "time zone", "default servings", "portions", "breakfast", "lunch", "dinner", "planned meal types"],
      },
      {
        to: "/settings/members",
        label: "Members",
        sub: "Invite by email or name, remove, leave",
        keywords: ["invite", "invites", "people", "member", "family", "spouse", "allowlist", "pending invites", "leave household"],
      },
    ],
  },
  {
    id: "food",
    label: "Food & planning",
    sections: [
      {
        to: "/settings/preferences",
        label: "Preferences",
        sub: "Likes, dislikes, dietary restrictions",
        keywords: ["food preferences", "favourite", "favorite", "cuisine", "diet", "dietary", "vegetarian", "vegan", "gluten", "dairy", "allergy"],
      },
      {
        to: "/settings/nutrition",
        label: "Nutrition goals",
        sub: "Protein and fibre goals per meal, tracking on or off",
        keywords: ["protein", "fibre", "fiber", "nutrition", "goal", "track", "tracking", "grams", "macros", "health"],
      },
      {
        to: "/settings/sides",
        label: "Sides",
        sub: "Fries, rice, buns, chips… portion per person",
        keywords: ["side", "portion", "bread", "frozen vegetables", "flag an ingredient"],
      },
      {
        to: "/settings/tools",
        label: "Kitchen tools",
        sub: "Equipment the household owns",
        keywords: ["tool", "equipment", "appliance", "instant pot", "skillet", "pan", "oven", "food processor", "sous vide"],
      },
      {
        to: "/settings/weights",
        label: "Suggestion weights",
        sub: "What raises or lowers a suggestion",
        keywords: ["weights", "score", "scoring", "ranking", "suggested", "suggestions"],
      },
    ],
  },
  {
    id: "shopping",
    label: "Shopping",
    sections: [
      {
        to: "/settings/stores",
        label: "Stores",
        sub: "PC Express store, Costco, sourcing rules, ChatGPT instructions",
        keywords: ["store", "shop", "shopping", "grocery", "loblaws", "pc express", "api key", "key", "sourcing", "rules", "category", "default store", "bulk", "chatgpt", "instructions", "copy"],
      },
      {
        to: "/settings/brands",
        label: "Brands",
        sub: "Preferred products per ingredient",
        keywords: ["brand", "product", "pack", "package", "preferred"],
      },
    ],
  },
  {
    id: "recipes",
    label: "Recipes & ingredients",
    sections: [
      {
        to: "/ingredients",
        label: "Ingredients",
        sub: "Catalogue, names and conversions",
        keywords: ["ingredient", "catalogue", "catalog", "names to decide", "aliases", "merge", "duplicates", "units", "density"],
      },
      {
        to: "/settings/gemini",
        label: "Gemini",
        sub: "AI for adding recipes and deciding new ingredient names",
        keywords: ["ai", "google", "llm", "api key", "key", "add recipe", "photo", "link"],
      },
    ],
  },
  {
    id: "you",
    label: "You & data",
    sections: [
      {
        to: "/settings/account",
        label: "Account",
        sub: "Signed-in email, sign out, invites to you",
        keywords: ["sign out", "log out", "logout", "email", "signed in", "display name", "invite", "invites", "join"],
      },
      {
        to: "/settings/theme",
        label: "Theme",
        sub: "Accent colour · just you",
        keywords: ["accent", "colour", "color", "catppuccin", "latte", "look", "appearance"],
      },
      {
        to: "/settings/data",
        label: "Data",
        sub: "Download or import household data",
        keywords: ["download", "export", "import", "backup", "file", "zip"],
      },
    ],
  },
];

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** True when every word of the query appears in the section's name, description or keywords. */
function sectionMatches(sec: Section, query: string): boolean {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = norm([sec.label, sec.sub, ...sec.keywords].join(" · "));
  return words.every((w) => hay.includes(w));
}

function SettingsPage() {
  const navigate = useNavigate();
  const [q, setQ] = React.useState("");
  const groups = SETTINGS_GROUPS.map((g) => ({ ...g, sections: g.sections.filter((s) => sectionMatches(s, q)) })).filter((g) => g.sections.length);
  const first = groups[0]?.sections[0];
  return (
    <PageBody>
      <PageHeader title="Settings" />
      <form
        role="search"
        className="max-w-[40rem]"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim() && first) void navigate({ to: first.to });
        }}
      >
        <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search settings…" aria-label="Search settings" />
      </form>
      {groups.length === 0 ? (
        <p role="status" className="m-0 text-sm font-bold">
          No settings match “{q.trim()}”.
        </p>
      ) : (
        <nav aria-label="Settings sections" className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[repeat(auto-fill,minmax(20rem,1fr))]">
          {groups.map((g) => (
            <section key={g.id} aria-labelledby={`settings-group-${g.id}`} className="flex flex-col gap-2.5" data-testid="settings-group">
              <h2 id={`settings-group-${g.id}`} className="kicker m-0">
                {g.label}
              </h2>
              {g.sections.map((sec) => (
                <Link
                  key={sec.to}
                  to={sec.to}
                  className="flex items-center justify-between gap-3 rounded-ui border-bw bg-base px-3.5 py-3 text-ink no-underline shadow-hard"
                >
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[1rem] font-extrabold">{sec.label}</span>
                    <span className="text-xs font-semibold text-sub">{sec.sub}</span>
                  </span>
                  <span aria-hidden className="text-lg font-extrabold">
                    →
                  </span>
                </Link>
              ))}
            </section>
          ))}
        </nav>
      )}
    </PageBody>
  );
}
