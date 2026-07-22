import request from "supertest";
import app from "../index";

const toOpenApiPath = (p: string): string => p.replace(/:([^/]+)/g, "{$1}");

function discoverRoutePaths(): string[] {
  const stack = (
    app as unknown as {
      _router: { stack: Array<{ route?: { path: string } }> };
    }
  )._router.stack;
  const paths = new Set<string>();
  for (const layer of stack) {
    if (layer.route && typeof layer.route.path === "string") {
      paths.add(toOpenApiPath(layer.route.path));
    }
  }
  return Array.from(paths);
}

describe("OpenAPI paths smoke test", () => {
  let specPaths: string[];

  beforeAll(async () => {
    const res = await request(app).get("/api/v1/openapi.json");
    specPaths = Object.keys(res.body.paths ?? {});
  });

  it("every mounted /api/v1 route appears in the OpenAPI spec", () => {
    const mounted = discoverRoutePaths().filter(
      (p) => p.startsWith("/api/v1/") && p !== "/api/v1/openapi.json",
    );
    expect(mounted.length).toBeGreaterThan(0);
    const missing = mounted.filter((p) => !specPaths.includes(p));
    expect(missing).toEqual([]);
  });

  it("spec has no paths pointing at non-existent routes", () => {
    const mounted = new Set(discoverRoutePaths());
    const undocumented = specPaths.filter(
      (p) =>
        p.startsWith("/api/v1/") &&
        !mounted.has(p) &&
        p !== "/api/v1/openapi.json",
    );
    expect(undocumented).toEqual([]);
  });

  it("serves valid OpenAPI 3.0 spec", async () => {
    const res = await request(app).get("/api/v1/openapi.json");
    expect(res.status).toBe(200);
    expect(res.body.openapi).toMatch(/^3\./);
    expect(res.body.paths).toBeDefined();
    expect(res.body.info).toBeDefined();
  });
});
