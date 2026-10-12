// Recipes library: search, filters and sorts in the shared <CollectionView>, favourites, card stats and protein
// (TECHNICAL_SPECS §14.1 recipes-browse.spec.ts; M1 parts). Reads the 28 seeded household recipes only; other specs add
// recipes of their own in parallel, so assertions are about what must and mustn't be listed, never global counts.
import { adminDb } from "../fixtures/admin";
import { makeRecipe, seedRecipeId, uniqueTitle, waitForIndexed } from "../fixtures/recipes";
import { expect, test } from "../fixtures/test";
import { RecipesPage } from "../pages/recipes";

test.describe("search", () => {
  test("full-text search over title, ingredients, tags, and household notes", { tag: ["@R4.1"] }, async ({ page, household }) => {
    const r = new RecipesPage(page);
    await r.goto();

    await r.searchFor("tandoori");
    await expect(r.card("Grilled Tandoori Chicken Skewers")).toBeVisible();
    expect(await r.titles()).not.toContain("Cake Mix Brownies");

    // An ingredient that isn't in the title.
    await r.searchFor("cardamom");
    await expect(r.card("Moroccan Spiced Chicken Thighs")).toBeVisible();
    expect(await r.titles()).not.toContain("Greek Salad");

    // A tag.
    await r.searchFor("peppermint");
    await expect(r.card("Chocolate Peppermint Kiss Cookies")).toBeVisible();

    // The household's own note on a recipe.
    const id = await seedRecipeId("Easy Pork Ribs");
    await adminDb.doc(`households/${household.hid}/notes/${id}`).set({ text: "Grandpa's favourite with coleslaw", updatedBy: household.uid });
    await r.searchFor("coleslaw");
    await expect(r.card("Easy Pork Ribs")).toBeVisible();

    await r.searchFor("zzzz-no-such-recipe");
    await expect(page.getByText("No recipes match.")).toBeVisible();
    await page.getByRole("button", { name: "Clear search and filters" }).click();
    await expect(r.search).toHaveValue("");
    await expect(r.card("Easy Pork Ribs")).toBeVisible();
  });
});

test.describe("filters and sorts", () => {
  test("cuisine, main protein, protein per serving, time, and tags filter the list; state lives in the URL", { tag: ["@R4.2", "@R4.7"] }, async ({ page, household: _ }) => {
    const r = new RecipesPage(page);
    await r.goto();

    let sheet = await r.openFilters();
    await r.chip(sheet, "Cuisine", "Greek").click();
    await r.apply(sheet);
    await expect(page).toHaveURL(/cuisine=greek/);
    await expect(r.card("Tzatziki Sauce")).toBeVisible();
    await expect(r.card("Greek Marinated Chicken")).toBeVisible();
    expect(await r.titles()).not.toContain("Easy Pork Ribs");

    sheet = await r.openFilters();
    await r.chip(sheet, "Main protein", "Chicken").click();
    await r.apply(sheet);
    await expect(page).toHaveURL(/protein=chicken/);
    await expect(r.card("Greek Marinated Chicken")).toBeVisible();
    expect(await r.titles()).not.toContain("Tzatziki Sauce");
    await expect(page.getByRole("button", { name: "Remove filter Greek" })).toBeVisible();

    // The URL alone restores the filters (a reload, a shared link, Back).
    await page.reload();
    await expect(page.getByRole("button", { name: /^Filter and sort, 2 filters on$/ })).toBeVisible();
    await expect(r.card("Grilled Lemon-Oregano Chicken")).toBeVisible();

    await page.getByRole("button", { name: "Remove filter Greek" }).click();
    await expect(page).not.toHaveURL(/cuisine=/);
    await expect(r.card("Grilled Tandoori Chicken Skewers")).toBeVisible();
    await page.getByRole("button", { name: "Clear", exact: true }).click();

    // Protein per serving ≥ 35 g.
    await r.goto("?minProtein=35");
    await expect(r.card("Garlic Rice and Chicken")).toBeVisible();
    expect(await r.titles()).not.toContain("Cake Mix Brownies");

    // Total time ≤ 20 min and a tag.
    await r.goto("?maxTotal=20");
    await expect(r.card("Tzatziki Sauce")).toBeVisible();
    expect(await r.titles()).not.toContain("Easy Pork Ribs");
    sheet = await r.openFilters();
    await r.chip(sheet, "Tags", "Muffins").click();
    await r.chip(sheet, "Total time", "≤ 20 min").click(); // off again
    await r.apply(sheet);
    await expect(page).toHaveURL(/tags=muffins/);
    await expect(r.card("Oat Flour Banana Muffins")).toBeVisible();
    expect(await r.titles()).not.toContain("Tzatziki Sauce");

    // Supply filters are live since M3 (supply-based browsing below); "Uses expiring" since M5 (suggestions.spec.ts).
    sheet = await r.openFilters();
    await expect(sheet.getByRole("button", { name: /^Can make/ })).toBeEnabled();
    await expect(sheet.getByRole("button", { name: /^Uses expiring/ })).toBeEnabled();
    // Cost per serving is live since M2 (estimates); grocery and plan specs cover prices.
    await expect(sheet.getByRole("button", { name: /^≤ \$4/ })).toBeEnabled();
  });

  test("sort by name, quickest, and most protein", { tag: ["@R4.2"] }, async ({ page, household: _ }) => {
    const r = new RecipesPage(page);
    await r.goto("?protein=chicken&sort=name");
    let titles = await r.titles();
    expect(titles.length).toBeGreaterThanOrEqual(6);
    expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b)));
    await expect(page.getByTestId("recipe-count")).toContainText("NAME");

    await r.goto("?cuisine=greek&sort=quickest");
    titles = await r.titles();
    expect(titles[0]).toBe("Tzatziki Sauce"); // 5 minutes

    await r.goto("?cuisine=american&protein=chicken,beef&sort=protein");
    titles = await r.titles();
    expect(titles.indexOf("Garlic Rice and Chicken")).toBeLessThan(titles.indexOf("Homemade Cheeseburger Macaroni")); // 60 g vs 45 g
  });

  test("re-sorting shows skeleton cards (no text, aria-busy) instead of moving live cards, then the sorted cards", { tag: ["@R4.2"] }, async ({ page, household: _ }) => {
    const r = new RecipesPage(page);
    await r.goto("?sort=name"); // the whole library: A–Z and Suggested never agree on its order
    await expect(r.list.getByTestId("recipe-card").first()).toBeVisible();
    // Record whether skeletons ever appear: they may only last the 150 ms minimum.
    await r.list.evaluate((ul) => {
      const w = window as unknown as { __skeleton?: { seen: boolean; busy: boolean; text: string } };
      w.__skeleton = { seen: false, busy: false, text: "" };
      new MutationObserver(() => {
        const sk = ul.querySelectorAll("[data-testid=card-skeleton]");
        if (sk.length) {
          w.__skeleton!.seen = true;
          w.__skeleton!.busy ||= ul.getAttribute("aria-busy") === "true";
          w.__skeleton!.text += [...sk].map((e) => e.textContent).join("");
        }
      }).observe(ul, { childList: true, subtree: true, attributes: true });
    });
    const sheet = await r.openFilters();
    await sheet.getByRole("button", { name: "Suggested", exact: true }).click();
    await r.apply(sheet);
    await expect(page).not.toHaveURL(/sort=name/);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __skeleton: { seen: boolean } }).__skeleton.seen)).toBe(true);
    const seen = await page.evaluate(() => (window as unknown as { __skeleton: { busy: boolean; text: string } }).__skeleton);
    expect(seen.busy).toBe(true);
    expect(seen.text.trim()).toBe(""); // skeletons carry no text
    // Then the live cards come back, sorted, and the list is no longer busy.
    await r.settled();
    await expect(r.list.getByTestId("card-skeleton")).toHaveCount(0);
    await expect(r.list.getByTestId("recipe-card").first()).toBeVisible();
    await expect(page.getByTestId("recipe-count")).toContainText("SUGGESTED");
  });

  test("the Meals page uses the same search, filter, and sort component", { tag: ["@R4.7"] }, async ({ page, household: _ }) => {
    await page.goto("/meals");
    await expect(page.getByRole("searchbox", { name: "Search meals…" })).toBeVisible();
    await page.getByRole("button", { name: /^Filter and sort/ }).click();
    const sheet = page.getByRole("dialog", { name: "Filter & sort" });
    await expect(sheet.getByRole("button", { name: "Name", exact: true })).toBeVisible();
    await expect(sheet.getByRole("button", { name: /^Show \d+ meals$/ })).toBeVisible();
  });
});

test.describe("favourites and cards", () => {
  test("favourite from a card; the badge, the detail button, and the Favourites filter follow; favourites are per household", { tag: ["@R4.6"] }, async ({ page, household, browser }) => {
    const r = new RecipesPage(page);
    await r.goto("?cuisine=spanish");
    const card = r.card("Garlic Shrimp With Smoked Paprika");
    const star = card.getByRole("button", { name: "Favourite Garlic Shrimp With Smoked Paprika" });
    await expect(star).toHaveAttribute("aria-pressed", "false");
    await star.click();
    await expect(star).toHaveAttribute("aria-pressed", "true");
    await expect(card.getByText("★ FAV")).toBeVisible();

    const id = await seedRecipeId("Garlic Shrimp With Smoked Paprika");
    await expect.poll(async () => (await adminDb.doc(`households/${household.hid}/favourites/recipe_${id}`).get()).exists).toBe(true);

    await r.goto("?fav=1");
    await expect(r.card("Garlic Shrimp With Smoked Paprika")).toBeVisible();
    expect(await r.titles()).toEqual(["Garlic Shrimp With Smoked Paprika"]);

    await r.open("Garlic Shrimp With Smoked Paprika");
    await expect(page.getByRole("button", { name: "★ Saved" })).toBeVisible();
    await page.getByRole("button", { name: "★ Saved" }).click();
    await expect(page.getByRole("button", { name: "☆ Save" })).toBeVisible();
    await expect.poll(async () => (await adminDb.doc(`households/${household.hid}/favourites/recipe_${id}`).get()).exists).toBe(false);
    void browser;
  });

  test("cards show time, cuisine, protein per serving (\"~\" when approximate), and the household's cook stats", { tag: ["@R4.5", "@R6.15"] }, async ({ page, household }) => {
    // A recipe with an ingredient that has no protein data yet: its protein is approximate.
    const title = uniqueTitle("Approximate Bowl");
    await adminDb.doc("ingredients/e2e-mystery-paste").set({
      name: "e2e mystery paste",
      aliases: [],
      category: "pantry",
      defaultLocation: "pantry",
      allowedMeasures: ["weight"],
      canonicalUnit: "g",
      shelfLifeDays: { pantry: 30 },
      freezable: false,
      isStaple: false,
      freeUse: false,
      needsReview: true,
    });
    const approx = await makeRecipe(title, {
      content: {
        ingredients: [
          { id: "l1", ingredientId: "greek-yogurt", amount: 200, measure: "g", canonicalAmount: 200, displayText: "greek yogurt", optional: false },
          { id: "l2", ingredientId: "e2e-mystery-paste", amount: 50, measure: "g", canonicalAmount: 50, displayText: "mystery paste", optional: false },
        ],
        steps: [{ text: "Stir {{ing:l2}} into {{ing:l1}}.", ingredientRefs: ["l1", "l2"] }],
        servings: 1,
      },
    });
    await waitForIndexed(approx);

    const r = new RecipesPage(page);
    await r.goto("?cuisine=greek");
    const tzatziki = r.card("Tzatziki Sauce");
    await expect(tzatziki).toContainText(/5m · GREEK · 26 G PROTEIN/i); // uppercased by CSS, except the duration
    // Never cooked: no stats line at all (M7 review), not "never cooked" or "0×".
    await expect(tzatziki).not.toContainText(/NEVER COOKED|MADE|0×/i);
    await expect(tzatziki.getByRole("img", { name: "Tzatziki Sauce" })).toBeVisible();

    await r.goto(`?q=${encodeURIComponent(title)}`);
    await expect(r.card(title)).toContainText(/~21 G PROTEIN/i); // 200 g greek yogurt at 10.3 g/100 g; the paste has no data

    // Stats come from the household's stats docs (written by functions from M3); the card reads them.
    const id = await seedRecipeId("Greek Salad");
    await adminDb.doc(`households/${household.hid}/stats/recipe_${id}`).set({ timesCooked: 14, lastCookedAt: new Date("2026-09-21T18:00:00-04:00"), ratingSum: 120, ratingCount: 14 });
    await r.goto("?cuisine=greek");
    await expect(r.card("Greek Salad")).toContainText(/MADE 14× · LAST 21 SEP/i);
    await expect(r.card("Greek Salad")).toContainText("★ 8.6");
  });

  test("the library is global: another household sees the same recipes", { tag: ["@R2.9"] }, async ({ page, household: _, browser, uniqueEmail }) => {
    const r = new RecipesPage(page);
    const title = uniqueTitle("Shared Library Soup");
    await waitForIndexed(await makeRecipe(title));
    await r.goto(`?q=${encodeURIComponent(title)}`);
    await expect(r.card(title)).toBeVisible();

    // Someone in a different household.
    const ctx = await browser.newContext();
    const other = await ctx.newPage();
    const { allowlist, uidFor, seedProfile, seedHousehold } = await import("../fixtures/admin");
    const { signInWithEmailLink } = await import("../fixtures/test");
    const email = uniqueEmail("other-house");
    await allowlist(email);
    await signInWithEmailLink(other, email);
    await expect(other).toHaveURL(/\/welcome$/);
    const uid = (await uidFor(email))!;
    await seedProfile(uid, email, "Robin");
    await seedHousehold(uid, "Robin", "Other House");
    await expect(other).toHaveURL(/\/recipes$/, { timeout: 20_000 });
    const r2 = new RecipesPage(other);
    await expect(r2.list).toBeVisible();
    await r2.searchFor(title);
    await expect(r2.card(title)).toBeVisible();
    await ctx.close();
  });
});

test.describe("supply-based browsing (M3)", () => {
  test("recipes the supply left after the plan covers are marked; Can make and Use what's left filter them (R4.3, R4.4, R4.2)", { tag: ["@R4.3", "@R4.4", "@R4.2"] }, async ({ page, household }) => {
    const { makePlanRecipe, seedPeriod, seedPlanItem } = await import("../pages/plan");
    const { seedSupply } = await import("../pages/supply");
    const tag = Math.random().toString(36).slice(2, 7);
    const full = await makePlanRecipe(`Pantry rice ${tag}`, { lines: "Boil @jasmine rice{400%g} with @salt{1%tsp}." });
    const most = await makePlanRecipe(`Pantry lentils ${tag}`, { lines: "Simmer @dried red lentil{900%g} with @onion{100%g}." });
    const none = await makePlanRecipe(`Pantry salmon ${tag}`, { lines: "Roast @salmon fillet{600%g}." });
    // 1 kg rice, but a planned rice dinner takes 400 g: 600 g left still covers it. 900 g lentils, no onion: ~90 %.
    await seedSupply(household.hid, "jasmine-rice", [{ amount: 1000, location: "pantry", expiresInDays: 300 }]);
    await seedSupply(household.hid, "dried-red-lentil", [{ amount: 900, location: "pantry", expiresInDays: 300 }]);
    const pid = await seedPeriod(household.hid);
    await seedPlanItem(household.hid, pid, [full.id]);
    const r = new RecipesPage(page);
    await r.goto(`?q=${encodeURIComponent(`Pantry ${tag}`)}`);
    await expect(r.card(full.title).getByTestId("can-make")).toBeVisible();
    await expect(r.card(most.title)).toContainText("ALMOST");
    await expect(r.card(none.title).getByTestId("can-make")).toHaveCount(0);
    await r.goto(`?q=${encodeURIComponent(`Pantry ${tag}`)}&supply=can`);
    await expect(page.getByTestId("recipe-card")).toHaveCount(1);
    await expect(r.card(full.title)).toBeVisible();
    await r.goto(`?q=${encodeURIComponent(`Pantry ${tag}`)}&supply=useup`);
    await expect(page.getByTestId("recipe-card")).toHaveCount(2);
    await expect(r.card(none.title)).toHaveCount(0);
    // An expired lot doesn't count (R8.15).
    await seedSupply(household.hid, "jasmine-rice", [{ amount: 1000, location: "pantry", expiresInDays: -1 }]);
    await r.goto(`?q=${encodeURIComponent(`Pantry ${tag}`)}&supply=can`);
    await expect(page.getByTestId("recipe-card")).toHaveCount(0);
  });
});
