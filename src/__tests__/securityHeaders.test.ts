import request, { type Response } from "supertest";
import app from "../index";

const ROUTES = [
  { method: "get", path: "/health" },
  { method: "get", path: "/api/v1/pairs" },
  { method: "get", path: "/api/v1/config" },
  { method: "get", path: "/api/v1/webhooks" },
];

const SECURITY_HEADERS: [string, string | RegExp][] = [
  ["x-content-type-options", "nosniff"],
  ["x-frame-options", "DENY"],
  ["referrer-policy", "no-referrer"],
  ["strict-transport-security", /max-age=\d+/],
];

describe("Security headers on every response", () => {
  for (const { method, path } of ROUTES) {
    describe(`${method.toUpperCase()} ${path}`, () => {
      let res: Response;

      beforeAll(async () => {
        res = await (request(app) as unknown as Record<string, CallableFunction>)[method](path);
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
