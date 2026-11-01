# M14 — PC Express key as a setting

Status: done (owner checks below: paste the key on the live app; deploy is the owner's)

## Goal

Owner questions (2026-11-01) while connecting PC Express: why set an account email and password if nothing needs them,
and will the `x-apikey` last? Answers that became work: the website's store list, product search, and shelf prices are
public, so the PC Express module runs signed out on the website's public API key; that key can be rotated by Loblaw at
any time, so it is a setting the owner changes in the app instead of `functions/.env` and a deploy.

## Requirements covered

R6.28.

## Items (in build order)

### A. No PC Express account
- [x] Remove the sign-in path (`PCX_SIGNIN_URL`, token cache, `parseSignIn`, the stub's `/signin` and `signInFails`
      mode) and the `PCX_EMAIL` / `PCX_PASSWORD` secrets and their binding. Requests carry the API key only; a unit test
      checks there is no `Authorization` header.
- [x] Spec §8 "Authentication", §2 Secret Manager row, §13 secrets, SETUP.md, CLAUDE.md, M5 plan follow-up note.

### B. The API key in Settings → Stores (R6.28)
- [x] `pcxSession/config` (function-only, no rules change: default deny) holds `{ apiKey, updatedAt, updatedBy }`.
      `pcxDeps()` reads it on every call; no key = not connected. `PCX_ENABLED` / `PCX_API_KEY` leave `functions/.env`.
- [x] Callable `pcxSetKey({ hid, apiKey })`: member of `hid` and the owner (`OWNER_UID`), rate limited with the
      searches; saves (trimmed, `[A-Za-z0-9_-]`), tries a store lookup, reports "Saved, but PC Express didn't accept
      it: …" on failure; `""` clears. `pcxStatus` adds `canEditKey` and `keyHint` (last four characters) for the owner.
- [x] The weekly refresh's failure banner says a changed key goes in Settings → Stores and links there.
- [x] Emulator: the stub refuses any key but `stub-key` (403); the saved key is per household
      (`pcxSession/config_{hid}`) and never used for calls, so parallel e2e runs can't break each other; a test names
      its owner in `_stubPcx/{hid}.ownerUid`.
- [x] `<PcxKeyCard>` under the PC Express store card (owner only): how to copy the key, the saved key's hint, paste +
      Save, the result, Remove key. Statuses on the page ask again after a save.
- [x] Tests: functions (owner only, bad key kept and reported, good key connects and clears the last error, clear,
      emulator owner); e2e `@R6.28` in `prices.spec.ts` (not shown to a plain member; wrong key → 403 message; right key
      → toast and connected; remove).
- [x] Design-compare, phone and desktop: the prototype has no such card; it follows the PC Express store card above it
      (title, mantle info box with a mono label, input + ink button, dashed alert box). Placeholder shortened so the mono
      text fits on a phone.

## Decisions

- **Owner only, not every member:** the key is app-wide (every household's prices), so only `OWNER_UID` changes it.
- **A wrong key is still saved:** PC Express may be down rather than the key wrong; the message says so plainly and the
  owner can paste another or remove it.

## What's left for the owner

1. Deploy (push; CI deploys functions and hosting).
2. Signed in as the owner, Settings → Stores → PC Express API key: paste the `x-apikey` from loblaws.ca (the value that
   was in `functions/.env` before this milestone is in git history) and check it says it's working. If it reports a
   404 or another error even with a fresh key, the endpoints in `functions/src/pcx/endpoints.ts` need fixing (they have
   never been called against the real site).
3. Then pick the store and link products (SETUP.md "M5 operations").
