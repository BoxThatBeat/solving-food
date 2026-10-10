import { createFileRoute } from "@tanstack/react-router";
import { collectionSearchSchema } from "@solving-food/core";
import { z } from "zod";
import { PageBody } from "@/components/AppShell";
import { RecipeBrowser } from "@/components/recipes/RecipeBrowser";

const searchSchema = collectionSearchSchema.extend({ review: z.coerce.boolean().optional().catch(undefined) });

export const Route = createFileRoute("/_app/recipes/")({
  validateSearch: (s) => searchSchema.parse(s),
  component: RecipesPage,
});

function RecipesPage() {
  const { review, ...search } = Route.useSearch();
  return (
    <PageBody className="max-w-[112.5rem]">
      <RecipeBrowser search={search} reviewOpen={!!review} />
    </PageBody>
  );
}
