import request from "supertest";
import app from "../index";

const ROUTES = [
  { method: "get", path: "/health" },
  { method: "get", path: "/api/v1/pairs" },
  { method: "get", path: "/api/v1/config" },
  { method: "get", path: "/api/v1/webhooks" },
];

const SECURITY_HEADERS: [string, string | RegExp][] = [
  ["content-security-policy", /default-src 'none'/],
  ["x-content-type-options", "nosniff"],
  ["x-frame-options", "DENY"],
  ["referrer-policy", "no-referrer"],
  ["strict-transport-security", /max-age=31536000; includeSubDomains/],
];

describe("Security headers on every response", () => {
  for (const { method, path } of ROUTES) {
    describe(`${method.toUpperCase()} ${path}`, () => {
      let res: { headers: Record<string, string | undefined> };

      beforeAll(async () => {
        switch (method) {
          case "get":
            res = await request(app).get(path);
            break;
          default:
            throw new Error(`Unsupported test method: ${method}`);
        }
      });

      for (const [header, expected] of SECURITY_HEADERS) {
        it(`sets ${header}`, () => {
          const value = res.headers[header];
          expect(value).toBeDefined();
          if (expected instanceof RegExp) {
            expect(value).toMatch(expected);
          } else {
            expect(value).toBe(expected);
          }
        });
      }
    });
  }
});
