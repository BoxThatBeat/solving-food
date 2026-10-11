---
name: solving-food-skill
description: Turn a recipe (a web page URL, pasted text, or a photo of a cookbook page or recipe card) into a Cooklang `.cook` file in the exact format the Solving Food app imports, then deliver it to the app's drop folder. Use whenever someone wants a recipe added to Solving Food, asks for a .cook file, or shares a recipe link or photo "for the app".
---

# Recipe → Solving Food `.cook` file

Solving Food imports recipes from Cooklang files dropped into its cloud drop folder. A function parses each file,
checks the front matter, matches every ingredient to the app's ingredient list, downloads the photo, and adds the
recipe to the shared library. Your job: write that file correctly and deliver it.

## Steps

1. **Get the recipe.** Fetch the page (or read the photo / pasted text). Use the recipe as written: every
   ingredient with its amount, every step in order. Ignore ads, life stories, nutrition panels, and comments.
2. **Classify it.** Choose `cuisine` and `main_protein` from the fixed lists in
   [references/taxonomy.md](references/taxonomy.md). No other values are accepted.
3. **Write the front matter** (YAML between `---` lines). Required: `title`, `servings`, `cuisine`,
   `main_protein`, `prep_time`, `cook_time`, `tags`. Optional: `source`, `image`, `leftover_portions`, `prep`,
   `tools`. Details in [references/conventions.md](references/conventions.md).
4. **Write the body**: one paragraph per step, original order and wording, each ingredient marked with `@` where
   it is first used, with its amount. Syntax in [references/syntax.md](references/syntax.md).
5. **Name ingredients** the way the app knows them: check
   [references/ingredients.md](references/ingredients.md) and use that name or alias when it means the same thing.
6. **Check** with the list at the end of this file.
7. **Deliver** the file: drop folder via `gcloud`, or save it for the user to drop in the app. See
   [references/delivery.md](references/delivery.md).

Worked examples: [examples/web-page.md](examples/web-page.md) (a recipe URL) and
[examples/photo.md](examples/photo.md) (a photographed recipe card, with the photo uploaded alongside).

## Minimal shape

```cooklang
---
title: Sheet-Pan Salmon with Potatoes
servings: 4
cuisine: nordic
main_protein: fish
prep_time: 15 minutes
cook_time: 30 minutes
tags: [dinner, weeknight, one-pan]
source: https://example.com/salmon
image: https://example.com/salmon.jpg
leftover_portions: 2
---

Preheat the #oven{} to 220°C.

Toss @baby potatoes{600%g} with @olive oil{2%tbsp} and @salt{} on a #sheet pan{}. Roast ~{15%minutes}.

Add @salmon fillet{600%g} and @lemon{1}, sliced. Roast ~{12%minutes} more.
```

## Rules that matter most

- **Every ingredient appears as an `@` token with its quantity** at least once. Amounts in later mentions of the
  same ingredient are added together (batter + topping), so give each addition its own amount, or none.
- **Salt and pepper are two tokens**: `@salt{}` and `@black pepper{}`, even when the recipe lists them on one line.
- **Keep the recipe's own units** (cups, tbsp, oz, lb, g). The app shows cups and spoons as written,
  converts oz/lb (and fl oz, pints, quarts) to metric only, and converts everything to grams for Supply. Keep
  temperatures as written too (°F or °C); the app shows them in Fahrenheit. Convert Unicode fractions to decimals (`½` → `0.5`). Never invent grams the recipe doesn't give.
- **Count ingredients** use a bare number or a count noun: `@egg{2}`, `@garlic{3%cloves}`, `@lemon{0.5}`.
- **Preparation stays outside the token**: `@onion{1}, diced` not `@diced onion{1}`.
- **No amount given** ("salt to taste", "oil for frying"): `@salt{}`. It is marked optional and not tracked.
- **`cuisine` / `main_protein` only from the lists.** Unsure → closest match, then `other` / `none`.
- **`prep_time` + `cook_time` = the recipe's total time**, written like `"20 minutes"` or `"1 hour 15 minutes"`.
  Put marinating or chilling time in `prep_time` when the recipe counts it.
- **`tags`**: the course in lowercase (`breakfast`, `lunch`, `dinner`, `snack`, `side`, `dessert`, `appetizer`) plus
  a few useful words (main ingredients, `muffins`, `one-pan`). Never `recipe`.
- **One recipe per file.** Sub-recipes the dish needs (a sauce) can be a `= Section` in the same file; a
  separately useful recipe (a tzatziki you'd also make alone) gets its own file.
- **File name**: kebab-case of the title, `.cook` extension, e.g. `garlic-rice-and-chicken.cook`.

## Before delivering, check

- [ ] Front matter has all seven required keys; `servings` is a whole number.
- [ ] `cuisine` and `main_protein` are spelled exactly as in the lists.
- [ ] Every ingredient from the ingredient list is an `@` token with its amount; nothing was dropped or merged.
- [ ] Salt and pepper are separate tokens; preparation words are outside tokens.
- [ ] Steps keep the original order and meaning; timers use `~{n%minutes}`.
- [ ] `image` is a direct image URL, or a relative path to a photo you will upload with the file.
- [ ] `source` is the page URL (without tracking parameters) when there is one.
