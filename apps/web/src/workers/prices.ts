// The bundled price estimates for the plan worker (M23): the file as is, without the zod validation the main thread
// runs (data/prices.ts), so zod stays out of the worker. The same file passes that validation in the main bundle and in
// `pnpm prices:check`.
import type { PriceEstimate } from "@solving-food/core";
import priceFile from "../../../../data/price-estimates.json";

export const PRICE_ESTIMATES = (priceFile as { estimates: Record<string, PriceEstimate> }).estimates as Readonly<Record<string, PriceEstimate>>;
