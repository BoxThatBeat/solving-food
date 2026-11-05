// The grocery list (PRD §7; TECHNICAL_SPECS §8), split in M21: the builder (needs, packs, stores, prices, costs),
// staples, the stored draft, and the copy/display helpers. Everything is re-exported here, so
// `import … from "./grocery"` and the package's public surface are unchanged.

export * from "./builder";
export * from "./staples";
export * from "./draft";
export * from "./copy";
