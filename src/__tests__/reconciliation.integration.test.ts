import request from "supertest";
import app from "../index";
import type { SwapRecord, InvariantViolation } from "../reconciliation";

function makeConsistentSwap(id = "swap-1"): SwapRecord {
  return {
    id,
    sourceAsset: "USDC",
    destAsset: "EURC",
    amountIn: "1000",
    netAmount: "990",
    feeAmount: "10",
    amountOut: "915",
    rate: "0.92",
    status: "completed",
    createdAt: 10_000,
    updatedAt: 10_500,
    completedAt: 10_500,
  };
}

describe("POST /api/v1/admin/reconciliation/swaps — Integration", () => {
  const originalAdminToken = process.env.ADMIN_TOKEN;

  afterEach(() => {
    if (originalAdminToken !== undefined) {
      process.env.ADMIN_TOKEN = originalAdminToken;
    } else {
      delete process.env.ADMIN_TOKEN;
    }
  });

  it("returns a clean report with zero violations for consistent dataset", async () => {
    const records = [makeConsistentSwap("s-1"), makeConsistentSwap("s-2")];

    const res = await request(app)
      .post("/api/v1/admin/reconciliation/swaps")
      .send({ records });

    expect(res.status).toBe(200);
    expect(res.body.summary.consistent).toBe(true);
    expect(res.body.totalScanned).toBe(2);
    expect(res.body.violationCount).toBe(0);
    expect(res.body.violations).toEqual([]);
    expect(res.body.isBoundedLimitReached).toBe(false);
  });

  it("reports an injected imbalance with offending ID and structured reasons", async () => {
    const records = [
      makeConsistentSwap("s-ok"),
      {
        ...makeConsistentSwap("s-imbalanced"),
        amountIn: "1000",
        netAmount: "900",
        feeAmount: "50", // 50 missing!
      },
    ];

    const res = await request(app)
      .post("/api/v1/admin/reconciliation/swaps")
      .send({ records });

    expect(res.status).toBe(200);
    expect(res.body.summary.consistent).toBe(false);
    expect(res.body.violationCount).toBe(1);
    expect(res.body.violations[0].swapId).toBe("s-imbalanced");
    expect(res.body.violations[0].code).toBe("IMBALANCE_NET_PLUS_FEE");
    expect(res.body.violations[0].invariant).toBe("BALANCE_CONSERVATION");
  });

  it("reports an inconsistent status (e.g. completed missing completion timestamp)", async () => {
    const records = [
      {
        ...makeConsistentSwap("s-corrupt-status"),
        status: "completed",
        completedAt: undefined,
      },
    ];

    const res = await request(app)
      .post("/api/v1/admin/reconciliation/swaps")
      .send({ records });

    expect(res.status).toBe(200);
    expect(res.body.summary.consistent).toBe(false);
    expect(
      res.body.violations.some(
        (v: InvariantViolation) =>
          v.code === "STATUS_COMPLETED_MISSING_TIMESTAMP",
      ),
    ).toBe(true);
  });

  it("enforces bounded execution with custom maxRecords", async () => {
    const records = Array.from({ length: 50 }, (_, i) => makeConsistentSwap(`s-${i}`));

    const res = await request(app)
      .post("/api/v1/admin/reconciliation/swaps")
      .send({ records, maxRecords: 15, chunkSize: 5 });

    expect(res.status).toBe(200);
    expect(res.body.totalScanned).toBe(15);
    expect(res.body.isBoundedLimitReached).toBe(true);
    expect(res.body.chunksProcessed).toBe(3);
  });

  it("rejects non-array records payload with 400 invalid_request", async () => {
    const res = await request(app)
      .post("/api/v1/admin/reconciliation/swaps")
      .send({ records: "not-an-array" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_request");
  });

  it("enforces admin authentication when ADMIN_TOKEN is set", async () => {
    process.env.ADMIN_TOKEN = "super-secret-admin-token";

    // Unauthenticated request -> 401
    const resUnauth = await request(app)
      .post("/api/v1/admin/reconciliation/swaps")
      .send({ records: [] });
    expect(resUnauth.status).toBe(401);

    // Authenticated request -> 200
    const resAuth = await request(app)
      .post("/api/v1/admin/reconciliation/swaps")
      .set("Authorization", "Bearer super-secret-admin-token")
      .send({ records: [] });
    expect(resAuth.status).toBe(200);
    expect(resAuth.body.totalScanned).toBe(0);
  });
});
