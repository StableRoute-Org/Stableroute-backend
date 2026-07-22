import request from "supertest";
import app from "../index";

/**
 * Convert an Express route path (`/api/v1/pairs/:source/:destination`) into the
 * OpenAPI templated form (`/api/v1/pairs/{source}/{destination}`).
 */
const toOpenApiPath = (p: string): string => p.replace(/:([^/]+)/g, "{$1}");

/**
 * Enumerate every concrete route path registered on the Express app by walking
 * the router stack. Returns OpenAPI-templated path strings.
 */
const discoverRoutePaths = (): string[] => {
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
};

describe("GET /api/v1/openapi.json", () => {
  it("serves a 3.0.3 spec with the expected info block", async () => {
    const res = await request(app).get("/api/v1/openapi.json");
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe("3.0.3");
    expect(res.body.info.title).toBe("StableRoute Backend");
    expect(res.body.info.version).toBe("1.0.0");
  });

  it("documents every registered /api/v1 route (drift guard)", async () => {
    const res = await request(app).get("/api/v1/openapi.json");
    const specPaths: string[] = Object.keys(res.body.paths);

    const apiPaths = discoverRoutePaths().filter(
      (p) => p.startsWith("/api/v1/") && p !== "/api/v1/openapi.json",
    );

    expect(apiPaths.length).toBeGreaterThan(0);
    for (const p of apiPaths) {
      expect(specPaths).toContain(p);
    }
  });

  it("documents /api/v1/config (regression for the previously missing path)", async () => {
    const res = await request(app).get("/api/v1/openapi.json");
    expect(res.body.paths["/api/v1/config"]).toBeDefined();
    expect(res.body.paths["/api/v1/config"].get).toBeDefined();
    expect(res.body.paths["/api/v1/config"].patch).toBeDefined();
  });
});
