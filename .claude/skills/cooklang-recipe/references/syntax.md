# Cooklang syntax the importer reads

A subset of the Cooklang spec (https://cooklang.org/docs/spec/). Anything else is kept as plain text.

## Front matter

YAML between two `---` lines at the very top. Lists can be block style or `[a, b]`.

```yaml
---
title: Oatmeal Muffins
servings: 12
cuisine: american
main_protein: eggs
prep_time: "20 minutes"
cook_time: "20 minutes"
tags:
  - breakfast
  - muffins
---
```

## Ingredients: `@`

| Write | Means |
|---|---|
| `@salt` | one-word ingredient, no amount |
| `@salt{}` | same; needed for multi-word names: `@black pepper{}` |
| `@egg{2}` | count |
| `@flour{2%cups}` | amount and unit, separated by `%` |
| `@garlic{3%cloves}` | count noun (converted with the ingredient's unit weight) |
| `@butter{0.5%cup}` | decimals, not fractions where you can (`1/2` and `1 1/2` also work) |
| `@red pepper flakes{1%pinch}` | vague unit; not tracked |
| `@?pepitas{}` | optional ingredient (the `?` marks it) |
| `@cheddar cheese{1.5%cups}(grated)` | a note in brackets right after the token (optional; prefer `, grated`) |

Multi-word names end at `{`. Without braces only the first word is the name: `@olive oil` means "olive" followed
by the text " oil". **Always use braces for multi-word names.**

The same ingredient mentioned twice with amounts is **summed** into one ingredient line (for example
`@water{1%cup}` in step 2 and `@water{0.5%cup}` in step 5 → 1.5 cups). Each step still shows its own amount.

## Cookware: `#`

`#oven{}`, `#sheet pan{}`, `#12-cup muffin tin{}`. Single words can skip the braces (`#bowl`). Cookware becomes the
recipe's tools.

## Timers: `~`

`~{25%minutes}`, `~{1%hour}`, `~{30%seconds}`, or named: `~rest{10%minutes}`. Timers become step timers in the app's
cooking mode.

## Steps and sections

- A blank line separates steps; each paragraph is one step.
- `= Sauce` (a line starting with `=`) starts a section; the following steps belong to it.

## Comments and notes

- `-- text` to the end of the line is a comment; comments become the recipe's notes.
- `[- block comment -]` spans lines.
- `> text` at the start of a line is a note (also kept as recipe notes).
