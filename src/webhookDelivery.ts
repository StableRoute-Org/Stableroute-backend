import { createHmac } from "node:crypto";

export type DeliveryEvent = {
  id: string;
  ts: number;
  type: string;
  payload: Record<string, unknown>;
};

export type DeliveryWebhook = {
  id: string;
  url: string;
  events: string[];
  secret: string;
};

export type DeliveryOutcome = {
  webhookId: string;
  eventId: string;
  eventType: string;
  attempt: number;
  ok: boolean;
  status?: number;
  error?: string;
};

type FetchLike = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
  }
) => Promise<{ ok: boolean; status: number }>;

export type DeliveryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  onOutcome?: (outcome: DeliveryOutcome) => void;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const signWebhookBody = (body: string, secret: string): string =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

/**
 * Deliver one event to subscribed webhooks with signed retry attempts.
 */
export const deliverEvent = async (
  event: DeliveryEvent,
  webhooks: DeliveryWebhook[],
  options: DeliveryOptions = {}
): Promise<DeliveryOutcome[]> => {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 100;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const outcomes: DeliveryOutcome[] = [];
  const body = JSON.stringify(event);

  for (const webhook of webhooks.filter((candidate) => candidate.events.includes(event.type))) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let outcome: DeliveryOutcome;
      try {
        const response = await fetchImpl(webhook.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-StableRoute-Event": event.type,
            "X-StableRoute-Signature": signWebhookBody(body, webhook.secret),
          },
          body,
        });
        outcome = {
          webhookId: webhook.id,
          eventId: event.id,
          eventType: event.type,
          attempt,
          ok: response.ok,
          status: response.status,
        };
      } catch (err) {
        outcome = {
          webhookId: webhook.id,
          eventId: event.id,
          eventType: event.type,
          attempt,
          ok: false,
          error: err instanceof Error ? err.message : "delivery failed",
        };
      }

      outcomes.push(outcome);
      options.onOutcome?.(outcome);

      if (outcome.ok) break;
      const retryable = outcome.status === undefined || outcome.status >= 500;
      if (!retryable || attempt === maxAttempts) break;
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }

  return outcomes;
};
