# Worked example: a photographed recipe card

**Request:** the user sends a phone photo of a handwritten card, `IMG_2041.jpg`, and says "this is Grandma's,
please add it".

## 1. Read the card

> **Grandma's Banana Bread** (makes 1 loaf, about 10 slices)
> 3 ripe bananas · ⅓ cup melted butter · ¾ cup sugar · 1 egg, beaten · 1 tsp vanilla · 1 tsp baking soda ·
> pinch of salt · 1½ cups flour · ½ cup walnuts (optional)
> Oven 350°. Mash bananas, stir in butter. Mix in sugar, egg, vanilla. Sprinkle soda and salt over, mix in flour.
> Fold in nuts. Bake in greased loaf pan 1 hr.

Read carefully and transcribe; where handwriting is ambiguous, choose the common reading (here "350°" is °F) and
mention it to the user. Don't fill in missing amounts with guesses: an ingredient without an amount gets `{}`.

## 2. Decisions

- `servings`: 10 (slices).
- `cuisine`: `american`; `main_protein`: `none` (a sweet bake; the one egg doesn't make it an egg dish).
- Times: the card gives none for prep; mixing takes about 10 minutes, the bake 60. Write `prep_time: 10 minutes`
  and tell the user it was estimated.
- Tags: `breakfast`, `snack` is also fair; use the course first: `[snack, banana, baking, family recipe]`.
  `family recipe` puts the FAMILY badge on the card.
- `leftover_portions: 6`: a loaf lasts several days.
- The walnuts are optional: `@?walnuts{0.5%cup}`.
- "Pinch of salt": `@salt{1%pinch}`.
- No URL, so no `source`. The photo is a local file: use it as the image and upload it with the recipe.

## 3. The file: `grandmas-banana-bread.cook`

```cooklang
---
title: Grandma's Banana Bread
servings: 10
cuisine: american
main_protein: none
prep_time: 10 minutes
cook_time: 60 minutes
tags: [snack, banana, baking, family recipe]
image: IMG_2041.jpg
leftover_portions: 6
prep:
  - Preheat the oven to 350°F
  - Grease the loaf pan
  - Melt the butter
---

Preheat the #oven{} to 350°F.

Mash @banana{3} in a #mixing bowl{}, then stir in @butter{0.33%cup}, melted.

Mix in @white sugar{0.75%cup}, @egg{1}, beaten, and @vanilla extract{1%tsp}.

Sprinkle @baking soda{1%tsp} and @salt{1%pinch} over the mixture, then mix in @all-purpose flour{1.5%cups}.

Fold in @?walnuts{0.5%cup}.

Pour into a greased #loaf pan{} and bake ~{1%hour}.

-- From Grandma's recipe card.
```

## 4. Deliver

Upload the photo first, then the recipe, to the same folder:

```sh
gcloud storage cp IMG_2041.jpg grandmas-banana-bread.cook gs://solvingfood.firebasestorage.app/recipe-drop/<uid>/
```

Or hand both files to the user to drag onto the app's Drop page together.
