import { describe, expect, it } from "vitest";
import {
  allowlistSchema,
  cookEventSchema,
  directorySchema,
  groceryListSchema,
  householdSchema,
  ingredientSchema,
  inviteSchema,
  mealSchema,
  memberSchema,
  planItemSchema,
  recipeSchema,
  supplySchema,
  transactionSchema,
  userSchema,
} from "./types";

const now = new Date("2026-10-09T12:00:00Z");
const ts = { toMillis: () => now.getTime() };

// Examples follow TECHNICAL_SPECS §4 and §5.
describe("document schemas accept the spec examples", () => {
  it("users", () => {
    expect(
      userSchema.parse({
        email: "buitenwerfa@gmail.com",
        activeHouseholdId: "hh1",
        householdsCreated: 1,
        theme: { flavour: "latte", accent: "green" },
      }),
    ).toBeTruthy();
  });

  it("users: rejects more than 3 households created and unknown flavours", () => {
    const base = { email: "a@b.co", activeHouseholdId: null, theme: { flavour: "latte", accent: "green" } };
    expect(userSchema.safeParse({ ...base, householdsCreated: 4 }).success).toBe(false);
    expect(
      userSchema.safeParse({ ...base, householdsCreated: 0, theme: { flavour: "dracula", accent: "green" } }).success,
    ).toBe(false);
  });

  it("allowlist and directory", () => {
    expect(allowlistSchema.parse({ addedBy: "uid1", addedAt: ts, inviteHouseholdId: "hh1" })).toBeTruthy();
    expect(directorySchema.parse({ displayName: "Aaron", displayNameLower: "aaron" })).toBeTruthy();
    expect(directorySchema.safeParse({ displayName: "   ", displayNameLower: "" }).success).toBe(false);
  });

  it("ingredients: potato with a unit weight, milk with a density", () => {
    const common = {
      aliases: [],
      category: "Produce",
      defaultLocation: "pantry",
      shelfLifeDays: { pantry: 30, fridge: null },
      freezable: false,
      isStaple: false,
      freeUse: false,
      needsReview: false,
    };
    expect(
      ingredientSchema.parse({
        ...common,
        name: "potato",
        allowedMeasures: ["weight", "count"],
        canonicalUnit: "g",
        unitWeightG: 213,
        proteinPer100g: 2,
      }),
    ).toBeTruthy();
    expect(
      ingredientSchema.parse({
        ...common,
        name: "milk",
        category: "Dairy",
        defaultLocation: "fridge",
        allowedMeasures: ["volume", "weight"],
        canonicalUnit: "g",
        densityGPerMl: 1.03,
      }),
    ).toBeTruthy();
  });

  it("recipes", () => {
    expect(
      recipeSchema.parse({
        title: "Miso salmon",
        slug: "miso-salmon",
        servings: 4,
        prepMin: 10,
        cookMin: 15,
        cuisine: "japanese",
        mainProtein: "fish",
        tags: ["weeknight"],
        tools: [],
        ingredients: [
          {
            id: "i1",
            ingredientId: "salmon-fillet",
            amount: 600,
            measure: "g",
            canonicalAmount: 600,
            displayText: "600 g salmon",
            optional: false,
          },
        ],
        steps: [{ text: "Roast the @salmon.", ingredientRefs: ["i1"], timerSeconds: 720 }],
        prepTasks: [{ text: "Pat the salmon dry", ingredientRefs: ["i1"] }],
        defaultLeftoverPortions: 0,
        fingerprint: "abc",
        ingredientIds: ["salmon-fillet"],
        imagePaths: [],
        indexChunk: 0,
        status: "active",
        createdBy: "u1",
        updatedBy: "u1",
        version: 1,
        createdAt: ts,
        updatedAt: ts,
      }),
    ).toBeTruthy();
  });

  it("recipes: cuisine must come from the fixed list", () => {
    expect(recipeSchema.shape.cuisine.safeParse("klingon").success).toBe(false);
  });

  it("meals", () => {
    expect(
      mealSchema.parse({
        name: "Taco night",
        recipes: [
          { recipeId: "tortillas", servingsMultiplier: 1 },
          { recipeId: "carnitas", servingsMultiplier: 1 },
        ],
        createdBy: "u1",
        updatedAt: ts,
      }),
    ).toBeTruthy();
  });

  it("households and members", () => {
    expect(
      householdSchema.parse({
        name: "Silbrass Pvt",
        createdBy: "u1",
        periodDays: 7,
        budgetCents: 20000,
        currency: "CAD",
        timezone: "America/Toronto",
        defaultServings: 4,
        plannedMealTypes: ["breakfast", "lunch", "dinner"],
        pcxStoreId: "loblaws-greenbank-road",
        currentPeriodId: null,
        settings: {
          scoreWeights: {},
          tools: ["Instant Pot"],
          preferences: { likes: [], dislikes: [], diets: [] },
          proteinGoals: { dinner: 35 },
        },
      }),
    ).toBeTruthy();
    expect(memberSchema.parse({ uid: "u1", displayName: "Aaron", joinedAt: ts })).toBeTruthy();
  });

  it("invites target exactly one invitee", () => {
    const base = { householdName: "Silbrass Pvt", invitedBy: "u1", createdAt: ts };
    expect(inviteSchema.safeParse({ ...base, inviteeUid: "u2" }).success).toBe(true);
    expect(inviteSchema.safeParse({ ...base, inviteeEmailLower: "x@y.ca" }).success).toBe(true);
    expect(inviteSchema.safeParse(base).success).toBe(false);
    expect(inviteSchema.safeParse({ ...base, inviteeUid: "u2", inviteeEmailLower: "x@y.ca" }).success).toBe(false);
  });

  it("plan items, cook events, grocery lists, supply, transactions", () => {
    expect(
      planItemSchema.parse({
        periodId: "p1",
        recipeId: "r1",
        mealType: "dinner",
        servings: 4,
        coverage: { dinner: 1, lunch: 2 },
        status: "planned",
        addedBy: "u1",
      }),
    ).toBeTruthy();
    expect(
      cookEventSchema.parse({
        recipeIds: ["r1"],
        titles: ["Miso salmon"],
        cookedBy: "u1",
        cookedAt: ts,
        used: [{ ingredientId: "salmon-fillet", canonicalAmount: 600 }],
        leftoverPortions: 2,
        reviewStatus: "pending",
        ratedBy: [],
      }),
    ).toBeTruthy();
    expect(
      groceryListSchema.parse({
        periodId: "p1",
        status: "draft",
        createdAt: ts,
        items: {
          a1: {
            ingredientId: "onion",
            amount: 1360,
            measure: "g",
            packs: 1,
            productName: "Yellow onions 3 lb",
            storeId: "pcx",
            estPriceCents: 399,
            source: "plan",
            checked: false,
          },
        },
      }),
    ).toBeTruthy();
    expect(
      supplySchema.parse({
        ingredientId: "rice",
        label: "Rice",
        canonicalAmount: 2000,
        canonicalUnit: "g",
        lots: [{ lotId: "l1", amount: 2000, location: "cupboard", acquiredAt: ts }],
      }),
    ).toBeTruthy();
    expect(
      transactionSchema.parse({ delta: -125, kind: "cook", lotId: "l1", uid: "u1", createdAt: ts }),
    ).toBeTruthy();
  });

  it("timestamps accept Date and Timestamp-like, reject strings", () => {
    expect(allowlistSchema.safeParse({ addedBy: "u", addedAt: now }).success).toBe(true);
    expect(allowlistSchema.safeParse({ addedBy: "u", addedAt: "2026-10-09" }).success).toBe(false);
  });
});
