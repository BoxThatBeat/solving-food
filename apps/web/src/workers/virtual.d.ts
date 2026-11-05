declare module "virtual:sf-seed-ingredients" {
  const seed: ReadonlyArray<Record<string, unknown> & { id: string }>;
  export default seed;
}
