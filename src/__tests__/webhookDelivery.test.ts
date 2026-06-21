import { createHmac } from "node:crypto";
import { deliverEvent, signWebhookBody, type DeliveryEvent, type DeliveryWebhook } from "../webhookDelivery";

const event: DeliveryEvent = {
  id: "evt_1",
  ts: 123,
  type: "pair.registered",
  payload: { source: "USDC", destination: "EURC" },
};

const webhook: DeliveryWebhook = {
  id: "wh_1",
  url: "https://hook.example/events",
  events: ["pair.registered"],
  secret: "super-secret",
};

describe("webhook delivery", () => {
  it("does not deliver to webhooks that are not subscribed to the event type", async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 204 }));
    const outcomes = await deliverEvent(
      event,
      [{ ...webhook, events: ["quote.created"] }],
      { fetchImpl }
    );
    expect(outcomes).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("signs delivery bodies with the webhook secret", async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 204 }));
    const outcomes = await deliverEvent(event, [webhook], { fetchImpl });

    expect(outcomes).toEqual([
      {
        webhookId: "wh_1",
        eventId: "evt_1",
        eventType: "pair.registered",
        attempt: 1,
        ok: true,
        status: 204,
      },
    ]);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      { method: "POST"; headers: Record<string, string>; body: string },
    ];
    const expectedBody = JSON.stringify(event);
    expect(init.body).toBe(expectedBody);
    expect(init.headers["X-StableRoute-Signature"]).toBe(
      `sha256=${createHmac("sha256", webhook.secret).update(expectedBody).digest("hex")}`
    );
    expect(signWebhookBody(expectedBody, webhook.secret)).toBe(
      init.headers["X-StableRoute-Signature"]
    );
  });

  it("retries 5xx responses and records each outcome", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const sleep = jest.fn(async () => undefined);
    const recorded: unknown[] = [];

    const outcomes = await deliverEvent(event, [webhook], {
      fetchImpl,
      sleep,
      baseDelayMs: 10,
      onOutcome: (outcome) => recorded.push(outcome),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(10);
    expect(outcomes.map((outcome) => outcome.status)).toEqual([500, 200]);
    expect(recorded).toEqual(outcomes);
  });

  it("stops retrying after a non-retryable 4xx response", async () => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 400 }));
    const sleep = jest.fn(async () => undefined);

    const outcomes = await deliverEvent(event, [webhook], { fetchImpl, sleep });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(outcomes[0]).toMatchObject({ ok: false, status: 400, attempt: 1 });
  });

  it("records exhausted retry attempts", async () => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 503 }));
    const sleep = jest.fn(async () => undefined);

    const outcomes = await deliverEvent(event, [webhook], {
      fetchImpl,
      sleep,
      maxAttempts: 3,
      baseDelayMs: 5,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 5);
    expect(sleep).toHaveBeenNthCalledWith(2, 10);
    expect(outcomes).toHaveLength(3);
    expect(outcomes[2]).toMatchObject({ ok: false, status: 503, attempt: 3 });
  });

  it("retries network errors before recording failure", async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error("socket timeout");
    });
    const sleep = jest.fn(async () => undefined);

    const outcomes = await deliverEvent(event, [webhook], {
      fetchImpl,
      sleep,
      maxAttempts: 2,
      baseDelayMs: 25,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(25);
    expect(outcomes).toEqual([
      {
        webhookId: "wh_1",
        eventId: "evt_1",
        eventType: "pair.registered",
        attempt: 1,
        ok: false,
        error: "socket timeout",
      },
      {
        webhookId: "wh_1",
        eventId: "evt_1",
        eventType: "pair.registered",
        attempt: 2,
        ok: false,
        error: "socket timeout",
      },
    ]);
  });
});
