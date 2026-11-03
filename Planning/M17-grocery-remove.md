# M17 — Remove a grocery line

Status: done (owner check below: deploy, then remove a line on the live app and Regenerate it back)

## Goal

Owner request (2026-11-03): "Can you add an x button beside all the ingredients in the grocery list? Some recipes will
call for an ingredient that we don't want to use so we want to be able to just remove it. The "regenerate grocery list"
button should put them all back."

## Requirements covered

R7.13 (new: remove any line; Regenerate restores), R7.12 (changed: Regenerate also brings removed staples back).

## Items (in build order)

### A. Core
- [x] `groceryItemSchema.removed?: boolean` (`packages/core/src/types.ts`).
- [x] `mergeDraft(existing, generated, { restore })` carries `removed` like a tick; `restore` drops it. `isRemoved`,
      `removedLineIds`, `withoutRemoved(built, ids)` (totals, unknown count and price sources recomputed). Unit test in
      `grocery.test.ts`.

### B. Web
- [x] `data/plan.ts`: `setLineRemoved(hid, id, on)`; `syncDraft(…, { restore })` (also on a period change; restore
      deletes `dismissedStaples`); `orderDraft(…, keep)` leaves the removed lines on the emptied draft.
- [x] `data/planModel.ts`: `removedIds`; the budget meter and Use it up read the built list without removed lines.
- [x] Grocery page: the × on every line (`Remove <product>`, 44 px on phone, 36 px from `sm`); plan lines are flagged,
      staples dismissed as before, manual lines deleted; toast "Removed X · Regenerate puts it back" with Undo; removed
      lines hidden, not copied, not ordered; "N removed · Regenerate puts them back" next to Regenerate; Regenerate
      restores everything.
- [x] Design-compare: **skipped at the owner's request** (as for M16). The × reuses the existing manual-line remove
      button (bordered square, lucide `X`), enlarged to a 44 px hit target on phone.

### C. Rules, docs and tests
- [x] `firestore.rules`: no change (item fields aren't validated); `tests/rules/plan.test.ts` covers the flag and
      clearing `dismissedStaples`.
- [x] PRD R7.13, R7.12; spec §4.2 grocery list row, §8 "Removing a line", §15 M17 row; Planning/README.
- [x] E2E `grocery.spec.ts` @R7.13: a plan line's × removes it, it stays removed after a reload and an order, the
      budget meter goes up, Regenerate brings it back.

## Decisions

- **A flag on the line, not a removed-ingredient list.** Plan lines are already keyed by ingredient ID, and ticks,
  regeneration and orders already work per line, so `removed: true` rides along with no new merge logic.
- **Removed lines stay through an order.** Otherwise the plan's still-unmet need would put the line straight back on
  the new draft after Copy.
- **Regenerate restores staples too.** The owner said Regenerate "should put them all back"; a removed staple's
  dismissal is cleared with the flags. Automatic regeneration still honours both.
- **A new period starts with nothing removed.** The draft belongs to the household and follows the current period; an
  ingredient skipped for one week's recipes isn't assumed unwanted next week.

## Exit criteria

- [x] Unit, rules and e2e tests pass (desktop-1080p and phone-ios).
- [ ] Owner: on the live app, remove a line, reload, Regenerate.
