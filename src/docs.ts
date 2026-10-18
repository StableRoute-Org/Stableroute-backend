import fs from "node:fs";
import path from "node:path";
import type { Express, Request, Response } from "express";
import { openApiSpec } from "./openapi";

/**
 * Public, human-facing routes: `/` (JSON service index), `/docs` (Swagger UI)
 * and `/openapi.yaml` (raw spec). Registered before the security/negotiation
 * middleware so browsers can load them with a relaxed CSP.
 */

const SPEC_CANDIDATES = [
  path.join(__dirname, "..", "openapi.yaml"),
  path.join(process.cwd(), "openapi.yaml"),
];

let cachedYaml: string | null | undefined;

export function loadOpenApiYaml(): string | null {
  if (cachedYaml !== undefined) return cachedYaml;
  cachedYaml = null;
  for (const candidate of SPEC_CANDIDATES) {
    try {
      const raw = fs.readFileSync(candidate, "utf8");
      // Point "Try it out" at the deployment that is serving the docs.
      cachedYaml = raw.replace(
        /^servers:\n/m,
        "servers:\n  - url: /\n    description: This deployment\n",
      );
      break;
    } catch {
      // try next candidate
    }
  }
  return cachedYaml;
}

const SWAGGER_VERSION = "5.17.14";

function docsHtml(specUrl: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>StableRoute API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui.css" />
  <style>body{margin:0;background:#fafafa}.topbar{display:none}</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.onload = function () {
      window.ui = SwaggerUIBundle({ url: ${JSON.stringify(specUrl)}, dom_id: "#swagger-ui", deepLinking: true });
    };
  </script>
</body>
</html>`;
}

export function registerDocsRoutes(app: Express): void {
  app.get("/", (_req: Request, res: Response) => {
    const endpoints = Object.keys(openApiSpec.paths).sort();
    res.json({
      service: "stableroute-backend",
      description:
        "StableRoute API gateway, routing engine and pricing service for Stellar stablecoin liquidity routing.",
      docs: "/docs",
      openapi: { yaml: "/openapi.yaml", json: "/api/v1/openapi.json" },
      health: "/health",
      endpoints,
    });
  });

  app.get("/openapi.yaml", (_req: Request, res: Response) => {
    const yaml = loadOpenApiYaml();
    if (yaml === null) {
      res.redirect(302, "/api/v1/openapi.json");
      return;
    }
    res.type("application/yaml").send(yaml);
  });

  app.get(["/docs", "/docs/"], (_req: Request, res: Response) => {
    const specUrl = loadOpenApiYaml() === null ? "/api/v1/openapi.json" : "/openapi.yaml";
    res.type("html").send(docsHtml(specUrl));
  });
}
