import { describe, expect, it } from "vitest";

const host = process.env.FUNCTIONS_EMULATOR_HOST ?? "127.0.0.1:5001";
const project = process.env.GCLOUD_PROJECT ?? "solvingfood";

describe("healthcheck (emulator)", () => {
  it("responds 200 with ok: true in us-east1", async () => {
    const res = await fetch(`http://${host}/${project}/us-east1/healthcheck`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "solving-food", region: "us-east1" });
  });
});
