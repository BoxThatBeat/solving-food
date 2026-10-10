// Page helpers for the Recipes pages (TECHNICAL_SPECS §14.1 "Page objects"): locators by role and accessible name.
import { expect, type Locator, type Page } from "@playwright/test";

export class RecipesPage {
  constructor(readonly page: Page) {}

  get search(): Locator {
    return this.page.getByRole("searchbox", { name: "Search recipes, ingredients, tags…" });
  }
  get list(): Locator {
    return this.page.getByRole("list", { name: "Recipes" });
  }
  card(title: string): Locator {
    return this.list.getByTestId("recipe-card").filter({ has: this.page.getByRole("heading", { name: title, exact: true }) });
  }
  titles(): Promise<string[]> {
    return this.list.getByRole("heading", { level: 3 }).allTextContents();
  }

  async goto(query = ""): Promise<void> {
    await this.page.goto(`/recipes${query}`);
    await expect(this.page.getByTestId("recipe-count")).not.toHaveText("LOADING…");
  }

  async searchFor(q: string): Promise<void> {
    await this.search.fill(q);
    await expect(this.page).toHaveURL(new RegExp(`[?&]q=${encodeURIComponent(q).replace(/%20/g, "(\\+|%20)")}`));
  }

  async openFilters(): Promise<Locator> {
    await this.page.getByRole("button", { name: /^Filter and sort/ }).click();
    const sheet = this.page.getByRole("dialog", { name: "Filter & sort" });
    await expect(sheet).toBeVisible();
    return sheet;
  }

  /** A chip in one group of the filter sheet ("Cuisine", "Main protein", "Tags", …); chips carry a count after the label. */
  chip(sheet: Locator, group: string, label: string): Locator {
    const name = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( \\d+)?$`);
    return sheet.getByRole("group", { name: group, exact: true }).getByRole("button", { name });
  }

  async apply(sheet: Locator): Promise<void> {
    await sheet.getByRole("button", { name: /^Show \d+ recipes$/ }).click();
    await expect(sheet).toBeHidden();
  }

  async open(title: string): Promise<void> {
    await this.card(title).getByRole("link").click();
    await expect(this.page.locator("#recipe-title")).toHaveText(title);
  }
}

/** The open recipe (full page on phones, right-hand pane on wide screens). */
export function detail(page: Page): Locator {
  return page.locator("article[aria-labelledby=recipe-title]");
}
