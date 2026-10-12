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
- Use `#cookware{}` for the pan, oven, appliance the step needs, and `~{n%minutes}` for each timed wait. Name the
  cookware with its canonical name from [taxonomy.md](taxonomy.md) "Cookware names", lower-case and without a size:
  `#skillet{}` (not `#large frying pan{}`), `#baking dish{}` (not `#9x13-inch pan{}`), `#sheet pan{}` (not
  `#rimmed baking sheet{}`). A size that matters goes in the step text.

## Ingredient names

Every `@ingredient{}` token must be a name or alias from `ingredients.md` whenever one means the same thing
(SKILL.md step 6 is the mandatory check). A name the app doesn't know becomes a new ingredient that someone has to
review and merge before the recipe reduces Supply or merges grocery lines, so:

- Strip preparation words before looking a name up, and write them after the token. The full list is in
  `ingredients.md` ("Preparation words go outside the token"): fresh, freshly, large, small, medium, chopped,
  minced, diced, sliced, boneless, skinless, shredded, grated, crushed, crumbled, ripe, packed, thawed, peeled,
  seeded, pitted, halved, quartered, cubed, julienned, trimmed, softened, melted, divided, finely, roughly, thinly,
  coarsely, lightly, room temperature, to taste, for serving, for garnish. `@chicken thigh{2%lb}, boneless, diced`.
- Anything after a comma or in parentheses is a qualifier: it goes after the token, never inside it.
- Fold spelling and regional variants to the listed spelling (`ingredients.md` "Spelling variants"): chile/chili/
  chilli, yoghurt, aubergine, courgette, scallion and spring onion, capsicum, garbanzo, caster and icing sugar,
  cornflour, rocket, prawns, mince.
- State words (ground, dried, canned, frozen) stay only when the list has that form (`@ground cumin`, `@dried
  oregano`, `@frozen peas`); otherwise use the plain listed name.
- Only when nothing listed means the same thing, use the plain grocery name, singular or plural as written, and list
  it with a one-line reason in the delivery message. Never a made-up compound ("@spicy chicken mix").
- Use the plain grocery name, singular or plural as written: `@cherry tomatoes{2%pints}`, `@egg{2}`.
- Descriptors that change the product stay in the name: `@smoked paprika`, `@unsalted butter`, `@greek yogurt`,
  `@extra virgin olive oil`. Preparation does not: `@onion{1}, finely chopped`.
- Salt and pepper on one line are **two tokens**: `@salt{}` and `@black pepper{}`.
- "Oil" alone: `@vegetable oil` unless the recipe names the oil.

## Amounts and units

- Keep the recipe's units: cups, tbsp, tsp, oz, lb, g, ml, cloves. The app shows cups, spoons, counts and metric amounts as written, converts oz, lb, fl oz, pints and quarts to metric only, and shows temperatures in Fahrenheit only. Supply and grocery amounts are always grams.
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
