# House conventions

These match the owner's own converted recipes (`data/recipes/README.md` in the Solving Food repo); follow them so
every file imports the same way.

## Front matter keys

| Key | Required | Value |
|---|---|---|
| `title` | yes | The recipe's name, in title case as published |
| `servings` | yes | Whole number. A batch bake: the number of pieces (12 muffins → 12). A range ("4–6") → the lower number |
| `cuisine` | yes | One of the cuisines in `taxonomy.md` |
| `main_protein` | yes | One of the proteins in `taxonomy.md` |
| `prep_time` | yes | `"N minutes"` (or `"1 hour 10 minutes"`). Hands-on time, including marinating if the recipe counts it |
| `cook_time` | yes | `"N minutes"`. Time on the heat or in the oven. `"0 minutes"` for no-cook recipes |
| `tags` | yes | List: course in lowercase (`breakfast`, `lunch`, `dinner`, `snack`, `side`, `dessert`, `appetizer`) first, then a few descriptive tags. Never `recipe` |
| `source` | no | The page URL, without tracking parameters (`?utm_…`, affiliate codes) |
| `image` | no | A direct image URL (`https://…/photo.jpg`), or a path to a photo uploaded with the file (see `delivery.md`). Not a page URL |
| `leftover_portions` | no | Portions expected to be left for later meals: big pots, batch cooking, meal prep. Omit for normal dinners |
| `prep` | no | List of mise en place tasks, in order: "Preheat oven to 350°F", "Dice the onion", "Melt the butter" |
| `tools` | no | Extra tools not mentioned as `#cookware` in the steps (rarely needed) |

## Body

- One paragraph per step, in the original order, keeping the original wording (light trimming of chatter is fine).
- Mark each ingredient where it is **first used** in the steps, with its full quantity. If the recipe uses it in
  parts ("half the butter… the remaining butter"), give each part its amount and they are added up.
- If the steps never mention an ingredient from the ingredient list (common with "season to taste"), add it to the
  step where it belongs, so **every listed ingredient appears at least once**.
- Steps without instructions in the source (a bare ingredient list): write short, plain steps that only combine
  what's listed. Don't invent techniques or ingredients.
- Use `#cookware{}` for the pan, oven, appliance the step needs, and `~{n%minutes}` for each timed wait.

## Ingredient names

- Use the plain grocery name, singular or plural as written: `@cherry tomatoes{2%pints}`, `@egg{2}`.
- Prefer a name from `ingredients.md`. "Boneless skinless chicken breasts" and "chicken breast" both resolve; a
  made-up compound ("@spicy chicken mix") does not.
- Descriptors that change the product stay in the name: `@smoked paprika`, `@unsalted butter`, `@greek yogurt`,
  `@extra virgin olive oil`. Preparation does not: `@onion{1}, finely chopped`.
- Salt and pepper on one line are **two tokens**: `@salt{}` and `@black pepper{}`.
- "Oil" alone: `@vegetable oil` unless the recipe names the oil.

## Amounts and units

- Keep the recipe's units: cups, tbsp, tsp, oz, lb, g, ml, cloves. The app shows the recipe's wording with the metric amount after it.
- If the recipe gives both ("1 cup / 240 ml"), use the first one shown.
- Unicode fractions become decimals: `½` → `0.5`, `⅓` → `0.33`, `1¾` → `1.75`.
- Ranges: write the range (`@garlic{2-3%cloves}`); the app uses the middle.
- Count-based ingredients: a number, or a count noun the recipe uses (`cloves`, `slices`, `cans`, `fillets`).
  For cans and packages give the size in the name or as weight when the recipe says it:
  `@diced tomatoes{28%oz}` rather than `@diced tomatoes{1%can}`.
- No amount ("to taste", "for serving", "for greasing"): `@salt{}`. Vague amounts: `@cayenne pepper{1%pinch}`.

## File

- Name: kebab-case of the title + `.cook` (`Grilled Lemon-Oregano Chicken` → `grilled-lemon-oregano-chicken.cook`).
- UTF-8 text, Unix line endings, under 1 MB.
