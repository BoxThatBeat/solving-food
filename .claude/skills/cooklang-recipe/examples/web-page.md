# Worked example: a recipe web page

**Request:** "Add this to Solving Food: https://www.example.com/recipes/lemon-garlic-chicken-orzo?utm_source=pin"

## 1. What the page says (after skipping the story and ads)

> **One-Pan Lemon Garlic Chicken Orzo** · Serves 4 · Prep 15 min · Cook 30 min
> Photo: `https://www.example.com/images/lemon-chicken-orzo-1200.jpg` (the page's `og:image`)
>
> Ingredients: 1½ lb boneless skinless chicken thighs · 1 tsp dried oregano · salt and pepper · 2 tbsp olive oil ·
> 1 onion, diced · 4 cloves garlic, minced · 1 cup orzo · 2½ cups chicken broth · zest and juice of 1 lemon ·
> 3 cups baby spinach · ½ cup grated parmesan
>
> 1. Season the chicken with oregano, salt and pepper. 2. Brown it in the oil in a large skillet, 4 minutes per
> side; set aside. 3. Soften the onion 3 minutes, add the garlic for 1 minute. 4. Stir in the orzo, broth, lemon
> zest and juice; nestle the chicken back in. Cover and simmer 15 minutes. 5. Stir in the spinach and parmesan
> until wilted.

## 2. Decisions

- `cuisine`: lemon, oregano, orzo → `mediterranean` (Greek-leaning, but not specifically Greek).
- `main_protein`: `chicken`.
- Times: 15 + 30, as published.
- Tags: course `dinner`, then `chicken`, `orzo`, `one-pan`.
- `source`: the URL without `?utm_source=pin`.
- Salt and pepper → `@salt{}` and `@black pepper{}`.
- "Zest and juice of 1 lemon" → one `@lemon{1}` token; the zest and juice are how it's used.
- 4 leftovers? A normal dinner for 4, so no `leftover_portions`.

## 3. The file: `one-pan-lemon-garlic-chicken-orzo.cook`

```cooklang
---
title: One-Pan Lemon Garlic Chicken Orzo
servings: 4
cuisine: mediterranean
main_protein: chicken
prep_time: 15 minutes
cook_time: 30 minutes
tags: [dinner, chicken, orzo, one-pan]
source: https://www.example.com/recipes/lemon-garlic-chicken-orzo
image: https://www.example.com/images/lemon-chicken-orzo-1200.jpg
prep:
  - Dice the onion
  - Mince the garlic
  - Zest and juice the lemon
  - Grate the parmesan
---

Season the @boneless skinless chicken thighs{1.5%lb} with @dried oregano{1%tsp}, @salt{} and @black pepper{}.

Brown the chicken in @olive oil{2%tbsp} in a #large skillet{}, ~{4%minutes} per side. Set aside.

Soften @onion{1}, diced, for ~{3%minutes}, then add @garlic{4%cloves}, minced, for ~{1%minute}.

Stir in @orzo{1%cup}, @chicken broth{2.5%cups}, and the zest and juice of @lemon{1}. Nestle the chicken back in, cover, and simmer ~{15%minutes}.

Stir in @baby spinach{3%cups} and @parmesan cheese{0.5%cup}, grated, until wilted.
```

## 4. Deliver

The image is a URL, so only the `.cook` goes up:

```sh
gcloud storage cp one-pan-lemon-garlic-chicken-orzo.cook gs://solvingfood.firebasestorage.app/recipe-drop/<uid>/
```

A green banner "Imported "One-Pan Lemon Garlic Chicken Orzo"…" appears in the app with an **Open recipe** link.
