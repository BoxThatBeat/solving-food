# M20 — Settings groups and search

Status: done

## Goal

Owner request (2026-11-04): the Settings page (a flat list of 12 links plus Invites and Account cards) is hard to find
things in. Approved plan items A–E: group the sections under headings, a search box at the top, Account and Nutrition
goals as their own pages with invites shown only when open, the ChatGPT instructions in Settings → Stores too, and the
docs, descriptions and tests to match. Not done (owner said no): showing each section's current value in its
description.

## Requirements covered

R11.16 (Settings groups), R11.17 (Settings search), R11.18 (Account and invites), R11.19 (ChatGPT instructions in
Stores); R11.4 moved to its own page.

## Items

- [x] **A. Groups (R11.16):** `SETTINGS_GROUPS` in `apps/web/src/routes/_app/settings/index.tsx`: Household (Household,
      Members) · Food & planning (Preferences, Nutrition goals, Sides, Kitchen tools, Suggestion weights) · Shopping
      (Stores, Brands) · Recipes & ingredients (Ingredients, Gemini) · You & data (Account, Theme, Data). Kicker `<h2>`
      per group, `<section>` regions in one `nav "Settings sections"`; columns from `lg`, stacked on phones.
- [x] **B. Search (R11.17):** "Search settings" box above the groups; every query word must be in the section's
      label, description or `keywords` (kept on each section in the same table). Empty groups hidden, "No settings
      match" when nothing is left, Enter opens the first match.
- [x] **C. Account and Nutrition goals (R11.18, R11.4):** `/settings/account` (signed in as, Sign out, an Invites card
      with Join / Decline or "No open invites."). The Settings page has no Invites or Account card; the shell's
      `<InviteBanner>` now shows on Settings too while an invite is open (hidden on `/settings/account`, which has the
      card). `/settings/nutrition` holds the "Track protein and fibre" switch and both goal cards, moved from
      Preferences. The Plan page's "Protein and fibre goals" link points to `/settings/nutrition`. No function or
      notification linked to the moved pieces (they link `/settings/data` and `/settings/stores`, unchanged).
- [x] **D. ChatGPT instructions in Stores (R11.19):** `ChatgptInstructions` extracted from `grocery.tsx` to
      `apps/web/src/components/grocery/ChatgptInstructions.tsx`; Settings → Stores has a "ChatGPT" card with it. Both
      read `settings.chatgptInstructions` from the live household doc.
- [x] **E. Docs and tests:** section descriptions updated (Preferences without protein and fibre; Stores mentions
      ChatGPT instructions; Account new). PRD R11.4, R11.16–R11.19, R7.5, §12 Settings row; spec §12 routes and the
      Settings page paragraph, §10 nutrition switch, copy button, §14.1 spec table, §15 milestone row.
      `e2e/specs/settings-nav.spec.ts` (new), `preferences.spec.ts` (goals on `/settings/nutrition`), `auth.spec.ts`
      (Sign out on `/settings/account`), `a11y.spec.ts` (`/settings/account` with invites).

## Deviations

- File named `M20-settings-groups.md` (the brief said M18): M18 and M19 were already taken by earlier milestones.
- Design-compare screenshots skipped at the owner's request for recent work; the prototype has no grouped Settings
  page, so the groups reuse its section-link cards and the app's `kicker` headings.
- Invites are not a separate card on the Settings page: the shell's existing invites banner (already on every other
  page) now also shows on Settings, which meets "only when there's at least one open invite" without a second copy.
