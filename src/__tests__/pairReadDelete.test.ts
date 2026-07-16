import request from "supertest";
import app from "../index";

/**
 * Dedicated coverage for:
 *   GET    /api/v1/pairs/:source/:destination  — single-pair read (200 / 404)
 *   DELETE /api/v1/pairs/:source/:destination  — unregister (204 / 404)
 *   pair.unregistered event recorded in GET /api/v1/events
 */

describe("pair read and unregister — 204 and 404 paths", () => {
  // ── helpers ────────────────────────────────────────────────────────────────

  const register = (source: string, destination: string) =>
    request(app).post("/api/v1/pairs").send({ source, destination });

  const readPair = (source: string, destination: string) =>
    request(app).get(`/api/v1/pairs/${source}/${destination}`);

  const deletePair = (source: string, destination: string) =>
    request(app).delete(`/api/v1/pairs/${source}/${destination}`);

  const listPairs = () => request(app).get("/api/v1/pairs");

  const listEvents = () => request(app).get("/api/v1/events?limit=100");

  // ── GET single pair ────────────────────────────────────────────────────────

  describe("GET /api/v1/pairs/:source/:destination", () => {
    it("returns 200 with registered:true for a registered pair", async () => {
      await register("RDSRC", "RDDST");
      const res = await readPair("RDSRC", "RDDST");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        source: "RDSRC",
        destination: "RDDST",
        registered: true,
      });
    });

    it("returns 404 not_found for an unregistered pair", async () => {
      const res = await readPair("NO", "PAIR");
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("not_found");
      expect(res.body.message).toMatch(/NO->PAIR is not registered/);
      expect(res.body.requestId).toBeTruthy();
    });

    it("includes requestId in the 404 error body", async () => {
      const rid = "test-read-rid-1";
      const res = await readPair("MISS", "PAIR").set("X-Request-Id", rid);
      expect(res.status).toBe(404);
      expect(res.body.requestId).toBe(rid);
    });

    it("returns 404 after the pair has been deleted", async () => {
      await register("DELREAD", "SRC");
      await deletePair("DELREAD", "SRC");
      const res = await readPair("DELREAD", "SRC");
      expect(res.status).toBe(404);
    });
  });

  // ── DELETE single pair ─────────────────────────────────────────────────────

  describe("DELETE /api/v1/pairs/:source/:destination", () => {
    it("returns 204 when deleting a registered pair", async () => {
      await register("DELSRC", "DELDST");
      const res = await deletePair("DELSRC", "DELDST");
      expect(res.status).toBe(204);
      expect(res.text).toBe("");
    });

    it("removes the pair from GET /api/v1/pairs after deletion", async () => {
      await register("REMSRC", "REMDST");
      await deletePair("REMSRC", "REMDST");
      const list = await listPairs();
      expect(list.status).toBe(200);
      expect(
        list.body.pairs.some(
          (p: { source: string; destination: string }) =>
            p.source === "REMSRC" && p.destination === "REMDST"
        )
      ).toBe(false);
    });

    it("returns 404 when deleting an unregistered pair", async () => {
      const res = await deletePair("GHOST", "PAIR");
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("not_found");
      expect(res.body.message).toMatch(/GHOST->PAIR is not registered/);
      expect(res.body.requestId).toBeTruthy();
    });

    it("second delete of the same pair returns 404 (idempotent-safe)", async () => {
      await register("IDEMDEL", "PAIR");
      const first = await deletePair("IDEMDEL", "PAIR");
      expect(first.status).toBe(204);
      const second = await deletePair("IDEMDEL", "PAIR");
      expect(second.status).toBe(404);
    });

    it("includes requestId in the 404 error body", async () => {
      const rid = "test-del-rid-1";
      const res = await deletePair("NOGHOST", "PAIR").set("X-Request-Id", rid);
      expect(res.status).toBe(404);
      expect(res.body.requestId).toBe(rid);
    });
  });

  // ── pair.unregistered event ────────────────────────────────────────────────

  describe("pair.unregistered event", () => {
    it("records a pair.unregistered event after successful DELETE", async () => {
      await register("EVTSRC", "EVTDST");
      const beforeTs = Date.now();
      await deletePair("EVTSRC", "EVTDST");

      const events = await listEvents();
      expect(events.status).toBe(200);
      const unregistered = events.body.items.filter(
        (e: { type: string; payload: { source: string; destination: string }; ts: number }) =>
          e.type === "pair.unregistered" &&
          e.payload.source === "EVTSRC" &&
          e.payload.destination === "EVTDST" &&
          e.ts >= beforeTs
      );
      expect(unregistered.length).toBeGreaterThanOrEqual(1);
    });

    it("does NOT record pair.unregistered when pair is not registered (404 path)", async () => {
      const eventsBefore = await listEvents();
      const countBefore = eventsBefore.body.items.filter(
        (e: { type: string }) => e.type === "pair.unregistered"
      ).length;

      await deletePair("NOEVT", "PAIR"); // 404 — no event

      const eventsAfter = await listEvents();
      const countAfter = eventsAfter.body.items.filter(
        (e: { type: string }) => e.type === "pair.unregistered"
      ).length;

      expect(countAfter).toBe(countBefore);
    });
  });
});
