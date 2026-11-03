// Add with Gemini (M16, R4.37): the prompt is the skill, a page becomes its Recipe JSON-LD or its text, Gemini's
// answer is read for the .cook file, and the URL guard refuses local and private addresses.
import { describe, expect, it } from "vitest";
import { cooklangToRecipe } from "./cooklang";
import {
  dropLocalImage,
  extractCook,
  extractRecipeJsonLd,
  htmlToText,
  notARecipe,
  pageContent,
  photoIsDish,
  recipeInstruction,
  renderSkillPrompt,
  safeRecipeUrl,
  siteRefusesApps,
  cleanRecipeText,
  SKILL_PROMPT_FILES,
} from "./recipeFromGemini";

const COOK = `---
title: Jam Toast
servings: 2
cuisine: other
main_protein: none
prep_time: 5 minutes
cook_time: 0 minutes
tags: [snack]
---

Spread @strawberry jam{2%tbsp} on @bread{2%slices}.
`;

describe("the prompt", () => {
  it("is the skill files in order, framed for a link or a photo", () => {
    const files = Object.fromEntries(SKILL_PROMPT_FILES.map((f) => [f, `contents of ${f}\n`])) as Parameters<typeof renderSkillPrompt>[0];
    const text = renderSkillPrompt(files);
    expect(text.indexOf("===== SKILL.md =====")).toBeLessThan(text.indexOf("===== references/ingredients.md ====="));
    expect(text).toContain("contents of references/conventions.md");
    expect(text).not.toContain("delivery.md");
    const link = recipeInstruction(text, { kind: "link", url: "https://example.com/r" });
    expect(link).toContain("https://example.com/r");
    expect(link).toContain("Skip its delivery step");
    expect(link).toContain("contents of SKILL.md");
    expect(recipeInstruction(text, { kind: "photo" })).toMatch(/Leave out `source` and `image`/);
  });
});

describe("reading the answer", () => {
  it("takes the .cook file from a fenced block or the bare file, and it imports", () => {
    expect(extractCook("Here it is:\n```cooklang\n" + COOK + "```\nEnjoy!")).toBe(COOK);
    expect(extractCook("```cook\n" + COOK + "```")).toBe(COOK);
    expect(extractCook(COOK)).toBe(COOK);
    expect(extractCook("Sorry, I can't.")).toBeNull();
    expect(cooklangToRecipe(extractCook("```cooklang\n" + COOK + "```")!, { resolve: () => null }).content.title).toBe("Jam Toast");
    expect(notARecipe("NOT A RECIPE")).toBe(true);
    expect(notARecipe(COOK)).toBe(false);
  });

  it("drops a local image path from a photo's file but keeps a URL", () => {
    expect(dropLocalImage(COOK.replace("tags:", "image: photo.jpg\ntags:"))).toBe(COOK);
    const withUrl = COOK.replace("tags:", "image: https://x.com/a.jpg\ntags:");
    expect(dropLocalImage(withUrl)).toBe(withUrl);
  });
});

describe("web pages", () => {
  const ld = { "@context": "https://schema.org", "@graph": [{ "@type": "WebPage" }, { "@type": ["Recipe"], name: "Jam Toast", recipeIngredient: ["2 tbsp jam"] }] };
  const html = `<html><head><script type="application/ld+json">{broken</script><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body><p>Life story…</p></body></html>`;

  it("prefers the Recipe JSON-LD, even inside @graph and after a broken block", () => {
    expect(extractRecipeJsonLd(html)).toMatchObject({ name: "Jam Toast" });
    expect(pageContent("https://x.com/r", html)).toMatch(/^Recipe data \(schema.org JSON-LD\) from https:\/\/x.com\/r:\n\{"@type":\["Recipe"\]/);
  });

  it("falls back to the visible text; next to nothing is null", () => {
    const page = `<html><head><style>.a{}</style></head><body><nav>Menu</nav><h1>Jam &amp; Toast</h1><p>${"Spread the jam on warm toast. ".repeat(10)}</p><script>track()</script></body></html>`;
    const text = htmlToText(page);
    expect(text).toContain("Jam & Toast");
    expect(text).not.toContain("track()");
    expect(text).not.toContain("Menu");
    expect(pageContent("https://x.com/r", page)).toMatch(/^Text of the page/);
    expect(pageContent("https://x.com/r", "<p>Hi</p>")).toBeNull();
  });

  it("only fetches public http(s) addresses", () => {
    expect(safeRecipeUrl("https://www.allrecipes.com/recipe/1")?.hostname).toBe("www.allrecipes.com");
    for (const bad of ["ftp://x.com/a", "http://localhost:8080", "http://127.0.0.1/a", "http://10.0.0.5/", "http://192.168.1.1", "http://169.254.169.254/latest", "http://[::1]/", "http://metadata.google.internal/", "not a url", "http://intranet/"]) {
      expect(safeRecipeUrl(bad)).toBeNull();
    }
  });
});

describe("a photo with the recipe's text", () => {
  it("asks which the photo shows and reads the PHOTO line; NOT A RECIPE still counts after it", () => {
    const sys = recipeInstruction("SKILL", { kind: "photo", withText: true });
    expect(sys).toContain("PHOTO: dish");
    expect(sys).toContain("except the PHOTO line");
    expect(recipeInstruction("SKILL", { kind: "photo" })).not.toContain("PHOTO: dish");
    expect(photoIsDish("PHOTO: dish\n```cooklang\n---\n```")).toBe(true);
    expect(photoIsDish("PHOTO: recipe\n```cooklang")).toBe(false);
    expect(photoIsDish("```cooklang\nPHOTO: dish")).toBe(false);
    expect(notARecipe("PHOTO: dish\nNOT A RECIPE")).toBe(true);
    expect(extractCook("PHOTO: dish\n```cooklang\n" + COOK + "```")).toBe(COOK.trim() + "\n");
  });

  it("cleans pasted text; knows a site refusing apps", () => {
    expect(cleanRecipeText("  a  \r\n\r\n\r\n\nb\t\n", 100)).toBe("a\n\nb");
    expect(cleanRecipeText("x".repeat(50), 10)).toHaveLength(10);
    expect([401, 403, 429, 451].every(siteRefusesApps)).toBe(true);
    expect(siteRefusesApps(404)).toBe(false);
  });
});
