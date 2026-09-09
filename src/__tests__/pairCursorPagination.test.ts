import request from "supertest";
import app, {
  encodePairListCursor,
  PAIR_LIST_CURSOR_MAX_LENGTH,
  parsePairListCursor,
} from "../index";
import { pairKey, pairRegistry, resetStores } from "../stores";

type PairItem = {
  source: string;
  destination: string;
};

const toPairKey = ({ source, destination }: PairItem): string =>
  pairKey(source, destination);

const responsePairKeys = (body: { pairs: PairItem[] }): string[] =>
  body.pairs.map(toPairKey);

const addPair = (source: string, destination = "USD"): void => {
  pairRegistry.add(pairKey(source, destination));
};

const registerPair = async (source: string, destination = "USD") => {
  const res = await request(app)
    .post("/api/v1/pairs")
    .send({ source, destination });
  expect([200, 201]).toContain(res.status);
};

const deletePair = async (source: string, destination = "USD") => {
  const res = await request(app).delete(`/api/v1/pairs/${source}/${destination}`);
  expect(res.status).toBe(204);
};

const jsonCursor = (payload: unknown): string =>
  Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");

const textCursor = (payload: string): string =>
  Buffer.from(payload, "utf8").toString("base64url");

describe("GET /api/v1/pairs keyset pagination", () => {
  beforeEach(() => {
    resetStores();
  });

  it("round-trips opaque versioned pair cursor helpers", () => {
    const cursor = encodePairListCursor("USDC::EURC");
    expect(cursor).not.toBe(Buffer.from("2", "utf8").toString("base64"));
    expect(Buffer.from(cursor, "base64url").toString("utf8")).not.toMatch(
      /^[0-9]+$/,
    );
    expect(parsePairListCursor(cursor)).toBe("USDC::EURC");
    expect(parsePairListCursor(undefined)).toBeUndefined();
  });

  it("pages forward through pairs with the unchanged response envelope", async () => {
    ["USDC", "BTC", "EURC", "XLM", "ADA"].forEach((source) => addPair(source));

    const first = await request(app).get("/api/v1/pairs").query({ limit: 2 });
    expect(first.status).toBe(200);
    expect(Object.keys(first.body).sort()).toEqual(["nextCursor", "pairs"]);
    expect(responsePairKeys(first.body)).toEqual(["ADA::USD", "BTC::USD"]);
    expect(parsePairListCursor(first.body.nextCursor)).toBe("BTC::USD");

    const second = await request(app)
      .get("/api/v1/pairs")
      .query({ limit: 2, cursor: first.body.nextCursor });
    expect(second.status).toBe(200);
    expect(responsePairKeys(second.body)).toEqual(["EURC::USD", "USDC::USD"]);
    expect(parsePairListCursor(second.body.nextCursor)).toBe("USDC::USD");

    const third = await request(app)
      .get("/api/v1/pairs")
      .query({ limit: 2, cursor: second.body.nextCursor });
    expect(third.status).toBe(200);
    expect(responsePairKeys(third.body)).toEqual(["XLM::USD"]);
    expect(third.body.nextCursor).toBeNull();
  });

  it("uses deterministic ordering independent of Set insertion order", async () => {
    ["ZZZ", "AAA", "MMM"].forEach((source) => addPair(source));

    const first = await request(app).get("/api/v1/pairs");
    expect(first.status).toBe(200);
    expect(responsePairKeys(first.body)).toEqual([
      "AAA::USD",
      "MMM::USD",
      "ZZZ::USD",
    ]);

    const second = await request(app).get("/api/v1/pairs");
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  it("does not duplicate or skip existing pairs when a new key sorts before the cursor", async () => {
    ["BBB", "DDD", "FFF", "HHH", "JJJ"].forEach((source) => addPair(source));

    const first = await request(app).get("/api/v1/pairs").query({ limit: 2 });
    expect(first.status).toBe(200);
    expect(responsePairKeys(first.body)).toEqual(["BBB::USD", "DDD::USD"]);

    await registerPair("AAA");

    const second = await request(app)
      .get("/api/v1/pairs")
      .query({ limit: 2, cursor: first.body.nextCursor });
    expect(second.status).toBe(200);

    const third = await request(app)
      .get("/api/v1/pairs")
      .query({ limit: 2, cursor: second.body.nextCursor });
    expect(third.status).toBe(200);

    const traversedKeys = [
      ...responsePairKeys(first.body),
      ...responsePairKeys(second.body),
      ...responsePairKeys(third.body),
    ];
    expect(traversedKeys).toEqual([
      "BBB::USD",
      "DDD::USD",
      "FFF::USD",
      "HHH::USD",
      "JJJ::USD",
    ]);
    expect(new Set(traversedKeys).size).toBe(traversedKeys.length);
  });

  it("may include a new key inserted after the cursor while preserving existing traversal", async () => {
    ["BBB", "DDD", "HHH", "JJJ"].forEach((source) => addPair(source));

    const first = await request(app).get("/api/v1/pairs").query({ limit: 2 });
    expect(first.status).toBe(200);
    expect(responsePairKeys(first.body)).toEqual(["BBB::USD", "DDD::USD"]);

    await registerPair("FFF");

    const second = await request(app)
      .get("/api/v1/pairs")
      .query({ limit: 3, cursor: first.body.nextCursor });
    expect(second.status).toBe(200);
    expect(responsePairKeys(second.body)).toEqual([
      "FFF::USD",
      "HHH::USD",
      "JJJ::USD",
    ]);
    expect(second.body.nextCursor).toBeNull();
  });

  it("continues after the cursor key when the last-seen pair was deleted", async () => {
    ["BBB", "DDD", "FFF", "HHH"].forEach((source) => addPair(source));

    const first = await request(app).get("/api/v1/pairs").query({ limit: 2 });
    expect(first.status).toBe(200);
    expect(responsePairKeys(first.body)).toEqual(["BBB::USD", "DDD::USD"]);

    await deletePair("DDD");

    const second = await request(app)
      .get("/api/v1/pairs")
      .query({ limit: 2, cursor: first.body.nextCursor });
    expect(second.status).toBe(200);
    expect(responsePairKeys(second.body)).toEqual(["FFF::USD", "HHH::USD"]);
    expect(second.body.nextCursor).toBeNull();
  });

  it("keeps the default limit compatible and clamps oversized limits to 500", async () => {
    for (let i = 0; i < 501; i++) {
      addPair(`P${i}`);
    }

    const defaultLimit = await request(app).get("/api/v1/pairs");
    expect(defaultLimit.status).toBe(200);
    expect(defaultLimit.body.pairs).toHaveLength(100);
    expect(defaultLimit.body.nextCursor).toBeTruthy();

    const clamped = await request(app).get("/api/v1/pairs").query({ limit: 999 });
    expect(clamped.status).toBe(200);
    expect(clamped.body.pairs).toHaveLength(500);
    expect(clamped.body.nextCursor).toBeTruthy();
  });

  it("returns an empty terminal page for a structurally valid cursor beyond the last key", async () => {
    ["AAA", "BBB"].forEach((source) => addPair(source));
    const cursor = encodePairListCursor("ZZZ::USD");

    const res = await request(app).get("/api/v1/pairs").query({ cursor });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pairs: [], nextCursor: null });
  });

  it("rejects invalid limit values through the typed error envelope", async () => {
    const res = await request(app)
      .get("/api/v1/pairs")
      .set("X-Request-Id", "bad-pair-limit")
      .query({ limit: "abc" });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: "invalid_request",
      error: "invalid_request",
      message: "limit must be a single integer",
      requestId: "bad-pair-limit",
    });
  });

  it("preserves ETag and 304 behavior for identical paginated requests", async () => {
    ["AAA", "BBB", "CCC"].forEach((source) => addPair(source));

    const first = await request(app).get("/api/v1/pairs").query({ limit: 2 });
    expect(first.status).toBe(200);
    expect(first.headers.etag).toBeTruthy();

    const repeated = await request(app).get("/api/v1/pairs").query({ limit: 2 });
    expect(repeated.status).toBe(200);
    expect(repeated.body).toEqual(first.body);
    expect(repeated.headers.etag).toBe(first.headers.etag);

    const cached = await request(app)
      .get("/api/v1/pairs")
      .query({ limit: 2 })
      .set("If-None-Match", first.headers.etag ?? "");
    expect(cached.status).toBe(304);
    expect(cached.text).toBe("");
  });

  it("applies the same keyset slice to HEAD requests", async () => {
    ["AAA", "BBB", "CCC"].forEach((source) => addPair(source));
    const first = await request(app).get("/api/v1/pairs").query({ limit: 2 });
    expect(first.status).toBe(200);

    const getSecond = await request(app)
      .get("/api/v1/pairs")
      .query({ limit: 2, cursor: first.body.nextCursor });
    expect(getSecond.status).toBe(200);

    const headSecond = await request(app)
      .head("/api/v1/pairs")
      .query({ limit: 2, cursor: first.body.nextCursor });
    expect(headSecond.status).toBe(200);
    expect(headSecond.headers.etag).toBe(getSecond.headers.etag);
    expect(headSecond.headers["content-length"]).toBe(
      Buffer.byteLength(getSecond.text).toString(),
    );
    expect(headSecond.text).toBeFalsy();
  });

  it("rejects invalid pair cursors on HEAD requests", async () => {
    const res = await request(app)
      .head("/api/v1/pairs")
      .query({ cursor: "not-base64-!!!" });

    expect(res.status).toBe(400);
    expect(res.text).toBeFalsy();
  });

  it("rejects invalid pair limits on HEAD requests", async () => {
    const res = await request(app).head("/api/v1/pairs").query({ limit: "abc" });

    expect(res.status).toBe(400);
    expect(res.text).toBeFalsy();
  });

  it.each([
    ["malformed base64url", "not-base64-!!!"],
    ["malformed decoded JSON", textCursor("not-json")],
    ["wrong object shape", jsonCursor({ v: 1 })],
    ["unsupported cursor version", jsonCursor({ v: 2, key: "AAA::USD" })],
    ["invalid cursor key", jsonCursor({ v: 1, key: "AAA:USD" })],
    ["empty cursor key part", jsonCursor({ v: 1, key: "AAA::" })],
    ["legacy numeric offset cursor", textCursor("2")],
    ["oversized cursor", "A".repeat(PAIR_LIST_CURSOR_MAX_LENGTH + 1)],
  ])("rejects %s with the typed invalid_request error", async (_name, cursor) => {
    const res = await request(app)
      .get("/api/v1/pairs")
      .set("X-Request-Id", "bad-pair-cursor")
      .query({ cursor });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: "invalid_request",
      error: "invalid_request",
      message: "cursor is invalid",
      requestId: "bad-pair-cursor",
    });
  });
});
