# Recipes (test data and first library)

Real household recipes exported from the owner's Obsidian vault on 2026-10-09. They are the seed library for
the deployed app and the fixtures for tests of the drop folder, search, and planning.

```
data/recipes/
├─ obsidian/              28 source notes, copied verbatim (frontmatter: Course, Cuisine, Duration, Servings, tags)
│  └─ attachments/        their cover images, downsized to ≤ 1600 px
└─ cooklang/              one .cook per note, in the schema the drop folder expects (TECHNICAL_SPECS §9)
```

## Cooklang conventions used here (and by the Claude skill in M1)

Front matter (YAML between `---` lines):

| Key | Required | Value |
|---|---|---|
| `title` | yes | Recipe name as in the note |
| `servings` | yes | Integer |
| `cuisine` | yes | One of `packages/core/taxonomy.ts` cuisines: american, british, canadian, caribbean, chinese, french, greek, indian, italian, japanese, korean, mediterranean, mexican, middle-eastern, nordic, spanish, thai, vietnamese, other |
| `main_protein` | yes | One of: beef, pork, chicken, turkey, lamb, fish, seafood, eggs, tofu, legumes, dairy, none |
| `prep_time` / `cook_time` | yes | `"N minutes"`; together they equal the note's Duration |
| `tags` | yes | List: the course in lowercase (breakfast, lunch, dinner, snack, side, dessert, appetizer) plus the note's ingredient tags (never `recipe`) |
| `source` | optional | URL from the note's Notes section |
| `image` | optional | Path relative to the `.cook` file, e.g. `../obsidian/attachments/baked-feta-pasta.jpg` |
| `leftover_portions` | optional | Portions expected to be left for later meals (batch bakes, big pots) |
| `prep` | optional | List of mise en place tasks (chop, measure, preheat) |

Body: one paragraph per step, original order and wording, with each ingredient marked where it is first used:
`@cherry tomatoes{2%pints}`, `@egg{2}` (count), `@salt{}` (no amount), multi-word names allowed; cookware
`#sheet pan{}`; timers `~{35%minutes}`. Every listed ingredient appears at least once with its quantity.
Original units are kept (cups, tbsp, oz, lb); the app converts. Unicode fractions become decimals. Preparation
words stay outside the ingredient token (`@garlic{2%cloves}, minced`). Comments use `-- `.

Filenames are kebab-case of the title.

## Known quirks in this set (useful as test cases, documented so nobody "fixes" the data by accident)

- **caesar-salad.cook** is a one-line stub in the vault ("Costco Chicken Nuggets"); it has one ingredient and one invented step.
- **greek-salad.cook** and **taco-seasoning.cook** had no instructions in the vault; short steps were written for them. Taco seasoning's servings (4) is inferred.
- **greek-turkey-meatballs-with-tzatziki.cook** refers to `tzatziki-sauce.cook` in a comment rather than embedding it; the meal feature (PRD §5) is the intended way to combine them.
- Several notes list **salt and pepper on one line**; they are two tokens (`@salt{}`, `@black pepper{}`), so token counts exceed line counts by one.
- Ingredients listed twice in a note (batter + streusel, two water additions) appear as **two tokens with the same name**; a parser must sum them.
- Marinating time isn't counted in the vault's Duration for the Greek and lemon-oregano chicken, so `prep_time + cook_time` understates real time there. Tandoori counts its 2-hour marinade as prep.
- Two image paths contain **spaces** (`Pasted image ….png/.jpg`). The importer must handle that.
- `check-cooklang.mjs` validates the conventions above; `node data/recipes/check-cooklang.mjs` must pass before any file here is changed.
