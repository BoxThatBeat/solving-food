# Solving Food — Product Requirements

> Status: Draft v0.4 · Source: `THOUGHTS.md` + answered open questions · Last updated: 2026-10-09

---

## 1. Vision & Goals

Solving Food is a household meal-planning app for a small circle of **friends and family**. It connects four things that usually live apart: **recipes**, **the meal plan**, **the grocery order**, and **what's actually in the kitchen**. It's built around one workflow: a household plans its meals for a configurable number of days, the app writes the grocery list, an LLM agent (ChatGPT with the PC Express plugin) places the order, and the app keeps track of what's left as the household cooks.

The name **Solving Food** is final.

### Primary goals

1. **Spend as little time on supply data entry as possible.** The app works out what's in the kitchen as *what was bought − what planned meals used*. Users only step in when reality didn't match the plan.
2. **Waste less food.** Point users at recipes that use up ingredients close to expiry.
3. **Plan within a budget.** Show what the plan period costs while users build it.
4. **Make cooking pleasant.** Recipes are easy to read on a phone, with a step-by-step mode.
5. **Learn what the household likes.** Ratings, cook history, and favourites shape future suggestions.

### Non-goals (v1)

- Placing grocery orders directly. The app hands off a list; an external LLM agent places the order.
- Reconciling the order confirmation or a receipt against the list automatically.
- Full nutrition tracking or calorie counting. **Protein is the only nutrient the app tracks** (§6.4).
- Non-food household items (cleaning supplies, toilet paper) on the grocery list.
- Weighing ingredients with scales or sensors. Supply is inferred, not measured.
- Importing recipes from URLs or photos inside the app. An external LLM does this and drops the result into the app (§4.3).

### Success metrics

| Metric | Target |
|---|---|
| Time to plan a period + produce the grocery list | < 10 minutes |
| Food discarded as expired (tracked internally) | trending down month over month |
| Planned meals actually cooked | > 95% |

---

## 2. Users, Households & Accounts

- **R2.1** Users sign in with **passwordless email** (magic link or one-time code).
- **R2.2** A **household** has one or more users. A user can belong to more than one household (e.g. a cottage, or a parent's home) and can switch the active household.
- **R2.3** Each user can **create up to 3 households**.
- **R2.4** Members invite others by **searching a directory of all users by name** and sending an invite. The invitee accepts it to join.
- **R2.5** There are **no roles**. Every member of a household can do everything in it, including deleting things and inviting or removing members.
- **R2.6** These belong to a **household** and are shared by all its members: supply, plans, grocery lists, cook history, favourites, brand mappings, stores, kitchen tools, preferences, suggestion weights, and settings.
- **R2.7** **Ratings are per user.** The household sees the average of its members' ratings.
- **R2.8** Households are **completely invisible to each other**. No household can see another's supply, plans, history, or ratings.
- **R2.9** The **recipe and meal library is global**. Every user can search, add, and edit it (§4).
- **R2.10** The only **per-user setting** is the theme (§11). Everything else is configured per household.
- **R2.11** Every household member gets the same experience on their own device. For example, a spouse can check the plan or cook from a recipe on their phone.
- **R2.12** **Open sign-up.** Anyone with the app's URL can create an account. Once signed up, they appear in the user directory so others can invite them to a household.

---

## 3. Core Loop

```mermaid
flowchart LR
    suggest["Suggest recipes"] --> plan["Plan the period"]
    plan --> grocery["Grocery list<br/>(auto-built)"]
    grocery --> order["Order<br/>(ChatGPT + PC Express)"]
    order --> supply["Supply<br/>+ bought"]
    supply --> cook["Cook<br/>(step view)"]
    cook --> review["Review & rate<br/>− used, + leftovers"]
    review --> suggest
```

1. **Suggest.** The app ranks recipes so the ones that use up supply close to expiry come first, while staying varied and within budget. A **Suggested** sort option is always available, and it also ranks the results of any filter.
2. **Plan.** The user adds recipes or saved meals to the plan. The budget meter goes down as they add.
3. **Grocery list.** The app works out *needed − projected supply*, applies preferred brands, and groups items by store.
4. **Order.** The user copies the list into ChatGPT, which orders it through the PC Express plugin. When the groceries arrive, the user confirms them and corrects any quantities that changed. The app adds them to supply.
5. **Cook.** The user opens a planned meal and cooks from the step view.
6. **Review.** The user rates the meal from 1 to 10, adjusts the ingredients they actually used, and confirms leftovers. Supply is updated.
7. **Carry over.** Meals not cooked by the end of the period carry over to the next one.

### The plan period

- The household configures the **plan period length in days** (default 7).
- A plan is a list of meals and recipes for that period, assigned to a meal type (breakfast, lunch, dinner, snack), not to specific days.
- There is **no limit** on how many meals a plan can hold, and users can add to the plan and generate a new grocery list at any point during the period.

---

## 4. Recipes

### 4.1 Library & Browsing

- **R4.1** Users can search recipes by name and full text (title, ingredients, tags, notes).
- **R4.2** Users can filter and sort by cuisine, main protein, protein per serving, total and active time, rating, whether the household has cooked it before, cost per serving, tags, favourites, and **"can make with current supply"**.
- **R4.3** Recipes the household can make with current supply, after subtracting what planned meals will use, are visibly marked.
- **R4.4** A special filter, **"Use what's left"**, shows only recipes that the remaining supply covers fully, or nearly fully.
- **R4.5** Recipe cards show stats such as *"You've made this 14 times"*, the last time it was cooked, and the household's average rating.
- **R4.6** Users can **favourite** recipes and meals. Favourites belong to the household. They're also how a household keeps track of its own recipes (e.g. family recipes), since there are no private recipes.
- **R4.7** The same filter and sort component is used everywhere a list of recipes or meals appears: Recipes, Plan, Meals, and History.

### 4.2 Recipe Detail & Cooking View

- **R4.8** The detail view shows the image, servings, times, ingredients, steps, tools, source link, and the household's notes.
- **R4.9** **Next to every ingredient**, the view shows how much of it is in supply (e.g. `Salmon 400 g · have 250 g ⚠`).
- **R4.10** **Step mode** shows one step at a time in large text, full screen, with that step's ingredients and any timers. The screen stays awake while it's open.
- **R4.11** Step instructions always show ingredient **amounts inline** where each ingredient is mentioned (e.g. "Add the butter (30 g)").
- **R4.12** A **mise en place** screen lists all prep tasks up front (chop, measure, preheat) before step mode starts.
- **R4.13** Users can scale servings, and quantities update to match.
- **R4.14** If the household is missing a tool the recipe needs (from the kitchen tools setting), the view says so.

### 4.3 Adding & Editing Recipes

- **R4.15** **Manual entry.** Users can add a recipe with a title, images, ingredients, steps, tags, cuisine, main protein, servings, times, and tools.
- **R4.16** **Drop folder.** A `.cook` (Cooklang) file placed in the app's cloud drop folder is imported automatically, and the file is deleted once it's processed. This is how recipes arrive from an external LLM: the user gives the LLM a recipe link or photo, the LLM writes a Cooklang file following a **Claude skill**, and drops it in the folder. Images referenced by the file are **saved into the app** (never hot-linked), and the result of each import (success or error) is shown as a notification (R12.1).
- **R4.17** The Claude skill defines the Cooklang schema the app expects, including **cuisine** and **main protein**, so the LLM infers them.
- **R4.18** **Full recipes are stored**, including all steps. The app is private to friends and family.
- **R4.19** **Anyone can edit any recipe**, and the change applies for all users. There are no private copies or forks. Edits are versioned so mistakes can be undone.
- **R4.20** **Deduplication.** When a recipe is added, the app checks for an existing one with the same source URL, a near-identical title, or a very similar ingredient set. If it finds one, the user chooses to keep the existing recipe, keep the new one, or keep both. Drop-folder imports that look like duplicates wait in a review list until someone decides.

### 4.4 Sharing & Export

- **R4.21** A **Copy link** button shares a recipe or meal. The link opens the normal recipe or meal page, which is readable without an account.
- **R4.22** Users can export a recipe as a `.cook` file.

### 4.5 Cooking Timers & Layouts

- **R4.23** **Timers alert even when the phone is locked** or the app is in the background. A notification announces which timer finished and opens the recipe at that step. On iPhone, this requires the app to be installed to the home screen, and the app prompts the user to install it the first time they start a timer.
- **R4.24** The cooking view has layouts for **phone portrait, phone landscape, and tablet**. On larger or landscape screens, the current step, its ingredients, and running timers are shown side by side, so a propped-up tablet can be followed from across the kitchen.

### 4.6 Managing the Library

- **R4.25** **Cuisine** and **main protein** are chosen from **fixed lists**, the same in the recipe form and the Claude skill, so recipes are classified consistently.
- **R4.26** **Any user can delete a recipe.** A confirmation dialog warns that it will be deleted **for all users in every household**. Deleting removes it from searches, meals, plans, and favourites everywhere. Past cook history keeps the recipe's name, marked as deleted.

---

## 5. Meals (Recipe Collections)

- **R5.1** A **meal** is a named collection of one or more recipes eaten together, e.g. *"Taco night" = tortillas + carnitas + pico de gallo*.
- **R5.2** Meals are saved in a **separate list** from recipes. They can be planned, favourited, rated, and shared like recipes.
- **R5.3** **Both meals and their individual recipes can be rated.**
- **R5.4** Meals are **not tied to a specific day**. A plan is a list of meals for the period, cooked in any order.
- **R5.5** Each planned meal has a type: breakfast, lunch, dinner, or snack. A meal-prep batch can cover several meal slots.
- **R5.6** When cooking a meal with several recipes, the user **chooses the order**. Each recipe's name shows its total time underneath, for quick reference.

---

## 6. Planning

### 6.1 Plan Page

- **R6.1** The Plan page shows the **meals selected for the current period** as a list that can be sorted and filtered.
- **R6.2** **Period coverage view.** Above the list, the Plan page shows the plan period as a **calendar-like strip**: one cell per day, labelled with its weekday and date for orientation, and one row per meal type the household plans (breakfast, lunch, dinner).
  - Cells **fill from left to right** as meals are added. Five dinners planned in a 7-day period fill the first five dinner cells, and the row reads **5/7**. It's a visual version of "5 of 7 dinners planned", **not a schedule**. Meals are never assigned to specific days, and the cells can't be tapped to pick a day.
  - A meal-prep recipe or leftover portions fill one cell per portion they cover (e.g. 4 lunches from one batch fill 4 lunch cells).
  - Cooked meals show as solid cells and planned-but-not-cooked meals as outlined cells, so the strip also shows progress through the period.
  - If more meals are planned than there are days, the row shows the overflow (e.g. **8/7, +1**).
  - Snacks aren't shown in the strip.
- **R6.3** A **budget meter** is always visible. It starts at the household's budget for the period and goes down as meals are added. The cost of a meal counts only ingredients that have to be bought; ingredients already in supply cost nothing extra.
- **R6.4** The budget covers **all food for planned meals** in the period. Food bought outside of recipes (manual list additions, staples) doesn't count against it.
- **R6.5** Going over budget is allowed. The meter goes negative and turns red, but the app **never stops** the user from adding meals.
- **R6.6** Meals not cooked by the end of the period **roll over** into the next period's plan automatically.
- **R6.7** Planned meals show an **expiry badge** when one of their ingredients is expiring soon, e.g. *"Salmon expires in 2 days"*.

### 6.2 Meal Prep & Leftovers

- **R6.8** One recipe can produce **several portions** that cover future lunches or breakfasts, and these can last into the next period.
- **R6.9** After a meal is cooked, the app asks: *"Estimated leftovers: 3 lunches — correct?"* The user adjusts the number with ▲/▼ buttons.
- **R6.10** Leftover portions are tracked as their own supply items, with an expiry date. They fill lunch/breakfast slots in the plan.

### 6.3 Suggestions

- **R6.11** The Plan page has a **Suggested** section ranked by a configurable score:

  | Positive factors | Negative factors |
  |---|---|
  | Expiry urgency (uses soon-to-expire supply) | Missing ingredients |
  | Supply utilisation (uses what's on hand) | Cost |
  | Household rating | Same main protein as other chosen meals |
  | Historical preference (frequency, recency) | Same cuisine as other chosen meals |
  | Variety | Recently cooked (avoid repetition) |
  | Matches household food preferences | Missing kitchen tools |
  | Meets the protein goal | |

- **R6.12** Users can **tune the weight** of each factor in Settings. Presets such as *"Use it up"*, *"Cheap week"*, and *"Adventurous"* are available.
- **R6.13** **Expiry alerts.** If supply will expire during the period (e.g. salmon), the app shows it prominently and suggests recipes that use more of it.

### 6.4 Protein Goal

- **R6.14** The household sets a **protein goal per serving** for each meal type (e.g. dinner ≥ 35 g). Each goal can be turned off.
- **R6.15** Recipe cards and the recipe page show **protein per serving**.
- **R6.16** Suggestions favour recipes that meet the goal (weighted like the other factors), and the optimiser can be told to only propose recipes that meet it.
- **R6.17** The Plan page shows the **average protein per serving** for each meal type in the current plan, next to the goal.

### 6.5 Budget Optimiser

- **R6.18** The user can ask for *"n dinners under $x"* (any meal type). The optimiser proposes a **complete set** of recipes that share ingredients, to cut waste and cost, but differ in cuisine and protein.
- **R6.19** If the user doesn't like the set, **Next** shows another set that also works well together, and **Back** returns to earlier sets. There's no fixed number of sets: Next keeps going through every combination that is genuinely good, then says *"No more good combinations"*.
- **R6.20** The user accepts a set as a whole, which adds every recipe in it to the plan. They can remove individual recipes from the Plan page afterwards.

### 6.6 Prices

- **R6.21** Ingredient prices come from **live PC Express data** where available. A preconfigured **estimated price list** is the fallback when live prices can't be fetched.
- **R6.22** Each household picks the **PC Express store** its prices come from, using an in-app store search. The default is **Loblaws Greenbank Road** (Ottawa).

---

## 7. Grocery List & Ordering

- **R7.1** The **grocery list** is generated automatically as *ingredients needed by the plan − projected supply*, rounded up to purchasable pack sizes.
- **R7.2** The list is **food only**.
- **R7.3** **Brand mapping.** A dedicated page maps a generic ingredient to a preferred product, e.g. `canned tomatoes → Mutti Polpa 400 g`. The grocery list uses the mapped product name, so the LLM orders the right thing.
- **R7.4** **Stores.** Each ingredient (or category) has a preferred store, e.g. *meat → Costco*. The list is grouped by store. Only the PC Express section is meant to be copied into ChatGPT. Other stores (e.g. Costco) become in-store checklists.
- **R7.5** **Copy button.** One button copies the PC Express section in a clean, LLM-friendly format with quantities and brands.
- **R7.6** **Manual additions.** Users can add any food item to the list at any time.
- **R7.7** **Staples cadence.** The app learns how fast the household uses staple foods (milk, eggs, coffee, and the free-use ingredients in R8.14). When an item is probably running low, it asks *"Are you out of milk?"* and offers to add it to the list.
- **R7.8** **Purchase confirmation.** After an order is delivered or a store trip is done, the user is shown the list of items to confirm. They can adjust for substitutions and out-of-stock items. If they change nothing, the app assumes everything was bought and arrived. The result is added to supply.
- **R7.9** **Freeze prompt for bulk buys.** Confirming a bulk purchase of a freezable item (e.g. 3 kg of chicken from Costco) asks *"Freeze some of this?"* and lets the user choose how much to freeze.
- **R7.10** **Product search for brand mapping.** The brand mapping page has an in-app **PC Express product search** showing name, pack size, image, and current price at the household's store. Picking a result links the ingredient to that exact product.

---

## 8. Supply

> Terminology: the app always says **Supply**, never "inventory".

- **R8.1** Supply is **inferred**: *purchases − consumption from cooked meals ± manual corrections*. Users don't need to weigh anything.
- **R8.2** Supply **starts empty**. Users can add what they already have by typing an ingredient name (e.g. "chicken"), choosing from the matching options, and entering an amount.
- **R8.3** Each ingredient has a configured set of **allowed measurements** (weight, volume, count) with the conversions between them. Amounts can be entered in any allowed measurement.
- **R8.4** The Supply page shows each ingredient as **current amount (amount left after all planned meals are cooked)**, e.g. `Rice 2.0 kg (1.2 kg)`.
- **R8.5** Expiry is tracked **per purchase**: two cartons of milk bought on different days have different expiry dates. Each purchase gets an **expected expiry date** (or none, for items that don't expire), estimated from the ingredient type and where it's stored. Items are visibly flagged as fresh, use soon, or expired.
- **R8.6** **Freezing.** Users can mark some or all of an item as frozen. The app stores both the original and the frozen expiry estimate and shows whichever applies. Thawing is supported too.
- **R8.7** **Transaction history.** Tapping an item shows the changes behind its number: purchases, meals cooked, corrections, freezes, and discards, each with a date and who did it. Long histories load more as the user scrolls.
- **R8.8** **Manual corrections** are always available ("I actually have ~500 g left", "threw this out"). The user can type an amount or use quick-adjust buttons (e.g. ±5 g / ±25 g, or the equivalent step for the measurement), then press **Apply**.
- **R8.9** **Discarded food is recorded** for internal waste tracking, but waste stats are not shown to users.
- **R8.10** Supply shows exact amounts. It doesn't show any "confidence" or uncertainty indicator.
- **R8.11** Supply tracks **leftovers** (prepared portions) as well as raw ingredients.
- **R8.12** Filters: by location (pantry, cupboards, fridge, freezer), category, expiring soon, low stock.
- **R8.13** **Metric and imperial together.** Every amount in the app (recipes, supply, grocery list) is shown in both systems, e.g. `1 cup flour (125 g · 4.4 oz)`. There's no setting to switch; both are always visible.
- **R8.14** **Free-use ingredients.** Ingredients used freely and often outside recipes, such as cooking oils, salt, pepper, and butter, aren't tracked by amount. Cooking doesn't subtract them and planned meals don't add them to the grocery list. The staples cadence (R7.7) handles them instead. They appear in a **Staples** group on the Supply page with when each was last bought. **Spices are not free-use** and are tracked like other ingredients. Which ingredients are free-use can be changed per ingredient.

---

## 9. Finishing a Meal

- **R9.1** While cooking, the user checks off each recipe in the meal as it's done. The **review flow opens automatically** once every recipe is checked off. It also opens if the user taps **Done cooking** before all recipes are checked off.
- **R9.2** The **review flow**:
  1. **Rate it 1–10.** Each user rates for themselves, and the meal and its recipes can each be rated (R5.3).
  2. **Adjust ingredients used.** The recipe quantities are pre-filled. The user can change any amount, remove an ingredient, or add one.
  3. **Confirm leftovers** with ▲/▼ (R6.9).
- **R9.3** Supply is reduced by the confirmed amounts, and leftover portions are added.
- **R9.4** A review doesn't have to be done straight away. Cooked meals without a review appear in a **"pending reviews"** prompt so any household member can finish it later (e.g. that evening). Each other member is prompted to add their own rating.
- **R9.5** The user can mark which planned items were **eaten**. This covers leftovers and snacks as well as cooked meals.

---

## 10. History

- **R10.1** The History page lists everything cooked: date, meal, ratings, who cooked it, notes, and deviations from the recipe.
- **R10.2** It uses the same filter and sort component as the other lists.
- **R10.3** It shows stats: most-cooked recipes, average rating by cuisine, and spend per period.

---

## 11. Settings & Preferences

Everything here belongs to the household except the theme, which is per user.

- **R11.1** **Kitchen tools.** The household lists the equipment it owns (Instant Pot, food processor, sous vide…). Recipes that need missing tools are flagged or filtered out.
- **R11.2** **Food preferences.** Favourite foods and cuisines, dislikes, and dietary restrictions, set once for the whole household and used in scoring.
- **R11.3** **Suggestion weights** (R6.12).
- **R11.4** **Protein goals** per meal type (R6.14).
- **R11.5** **Plan period** length in days.
- **R11.6** **Budget** for planned meals per period.
- **R11.7** **Brand mappings** and **stores** (dedicated page, §7).
- **R11.8** **Household members**: invite by name, remove members, leave the household.
- **R11.9** **Theme (per user).** Catppuccin flavour (Latte/Frappé/Macchiato/Mocha) and accent colour.
- **R11.10** **Download & import household data.** A **Download household data** button saves a file with all of the household's data (supply and its history, plans, grocery lists, cook history, ratings, favourites, notes, and settings) plus the recipes and meals it uses. An **Import household data** button loads such a file into the current household, after a warning that it **replaces** the household's existing data. Members aren't changed by an import.

---

## 12. Navigation & UX

### Pages

| Page | Purpose |
|---|---|
| **Plan** | Current period's meals, budget meter, suggestions, optimiser, expiry alerts, pending reviews |
| **Recipes** | Global library: search, filter, add, review possible duplicates |
| **Meals** | Saved recipe collections |
| **Supply** | Current and projected amounts, expiry dates, transactions |
| **Grocery** | Generated list grouped by store, copy button, purchase confirmation |
| **History** | Cooked meals, ratings, stats |
| **Settings** | Household, members, brands, stores, tools, preferences, weights, theme |

- **Landing page:** **Plan** if the current period has a plan, otherwise **Recipes**.

### Visual design

- **Brutalist** style: thick borders, hard shadows, monospace or grotesk type, visible structure, no gradients.
- **Catppuccin** palette, with a user-selectable accent.
- **Mobile-first.** Designed for phones first and fully usable one-handed in the kitchen.
- **Scales up properly to large screens**, including 1920×1080 desktops and 4K displays. Big screens use the extra space for more useful content, not stretched or tiny UI:
  - **Phone:** one column, bottom navigation.
  - **Tablet:** two panes where it helps (e.g. recipe list + selected recipe).
  - **Desktop (1080p):** side navigation and multi-pane views. For example, the Plan page shows the plan, suggestions, and budget/protein summary side by side, and recipe grids show more cards per row.
  - **4K:** text and controls scale up so they're comfortable to read at normal viewing distance (respecting the OS display scaling). Grids gain columns, but text stays at a readable line length and nothing stretches edge to edge.
  - **Step mode** gets larger text on bigger screens, so it can be read from across the kitchen on a mounted tablet or TV.
- Installable **PWA**: home-screen icon, works offline. Edits made offline sync when the device reconnects.
- UI inspiration: screenshots of the user's Obsidian recipe database and existing recipe apps (to collect).

### Notifications

- **R12.1** An app-wide **notification system** shows banners at the **bottom of every page** (above the bottom navigation on phones). It's used for things that finish in the background or fail, such as recipe imports, household data imports, and price refresh problems. Success and info banners disappear on their own after a few seconds. Errors stay until dismissed. A banner can link to the related page, e.g. the newly imported recipe.

---

## 13. Non-Functional Requirements

- **NFR1 Cloud-hosted on Firebase.** Hosting, user accounts, and the database all run on Firebase. Every household member can reach the app from anywhere, with nothing to run at home.
- **NFR2 Free tier.** The app stays within Firebase's free usage. Paid features are used only where they're unavoidable, and even then usage must stay inside the no-cost quotas.
- **NFR3 Scale.** Designed for about **3 households and 10 users** in the first year.
- **NFR4 Privacy.** Household data (supply, plans, history, ratings) is visible only to members of that household, enforced by database security rules.
- **NFR5 Live sync.** Changes made by one household member (plan, supply, grocery list) appear on other members' devices without a refresh.
- **NFR6 Responsive.** Every page works and looks intentional from a 360 px-wide phone up to a 3840×2160 (4K) display, with no horizontal scrolling and no pixelated images.
