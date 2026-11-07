// Settings → Gemini (PRD R11.15, R4.36; Planning/M16): the one place for the app's Gemini setup. The owner pastes the
// API key here (it moved from the Ingredients page); everyone else sees whether it's set up. Gemini decides new
// ingredient names (R4.27), adds recipes from a link or a photo (R4.37) and reads receipts (R7.15, M25).
import { createFileRoute, Link } from "@tanstack/react-router";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { ApiKeyCard } from "@/components/settings/ApiKeyCard";
import { Card, CardTitle } from "@/components/ui/card";
import { setAiKey, useAiStatus } from "@/data/ai";
import { useActiveHousehold } from "@/data/households";

export const Route = createFileRoute("/_app/settings/gemini")({
  component: GeminiPage,
});

function GeminiPage() {
  const hh = useActiveHousehold();
  const ai = useAiStatus(hh.id);
  return (
    <SettingsPage title="Gemini">
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <Card className="gap-3" data-testid="ai-status">
          <CardTitle>What Gemini does</CardTitle>
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[0.8125rem] font-semibold">
            <li>
              Adds a recipe from a web link or a photo (Recipes → <span className="font-extrabold">+ Add recipe</span>).
            </li>
            <li>
              Reads a receipt or an order email to fill in the groceries&apos; confirmation (Grocery → <span className="font-extrabold">From a receipt</span>).
            </li>
            <li>
              Decides whether a new ingredient name from an import is one the app already has (
              <Link to="/ingredients" className="font-extrabold text-ink underline">
                Ingredients
              </Link>
              ).
            </li>
          </ul>
          <p role="status" className={ai?.connected ? "m-0 tabular-nums text-[0.6875rem] font-bold" : "m-0 rounded-ui border-2 border-dashed border-line px-2.5 py-2 text-[0.8125rem] font-bold"}>
            {!ai ? "Checking Gemini…" : ai.connected ? "Gemini is set up" : ai.canEditKey ? "Gemini isn't set up yet: paste its API key." : "Gemini isn't set up yet. The app's owner adds its key here."}
          </p>
        </Card>
        {hh.id ? (
          <ApiKeyCard status={ai} title="Gemini API key" service="Gemini" testId="ai-key" onSave={(k) => setAiKey(hh.id!, k)}>
            <p className="m-0">
              Gemini&apos;s free tier does the work. Get a key at{" "}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="font-extrabold text-ink underline">
                aistudio.google.com/apikey
              </a>{" "}
              and paste it here.
            </p>
            <p className="m-0 rounded-ui border-2 border-dashed border-line px-2.5 py-2 font-bold">
              Create the key in a new Google Cloud project with no billing, never in the app&apos;s own project (it has billing on, so its key would be charged). On the
              free tier Google may use what&apos;s sent (ingredient names, the recipe pages and photos you add, and the receipts you read) to improve its products.
            </p>
          </ApiKeyCard>
        ) : null}
      </div>
    </SettingsPage>
  );
}
