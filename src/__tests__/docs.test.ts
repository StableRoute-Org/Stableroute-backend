import request from "supertest";
import app from "../index";

describe("public docs routes", () => {
  it("GET / describes the service", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.body.service).toBe("stableroute-backend");
    expect(res.body.docs).toBe("/docs");
    expect(Array.isArray(res.body.endpoints)).toBe(true);
  });

  it("GET /docs serves Swagger UI", async () => {
    const res = await request(app).get("/docs").set("Accept", "text/html");
    expect(res.status).toBe(200);
    expect(res.text).toContain("swagger-ui");
  });

  it("GET /openapi.yaml serves the spec", async () => {
    const res = await request(app).get("/openapi.yaml");
    expect(res.status).toBe(200);
    expect(res.text).toContain("openapi:");
  });

  it("GET /health returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});
