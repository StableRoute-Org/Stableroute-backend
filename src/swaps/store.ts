/**
 * In-memory repository for executed swaps.
 *
 * @module swaps/store
 */

import type { SwapRecord } from "./types";

export const swapStore = new Map<string, SwapRecord>();

export const resetSwapStore = (): void => {
  swapStore.clear();
};

export const saveSwap = (swap: SwapRecord): SwapRecord => {
  swapStore.set(swap.id, swap);
  return swap;
};

export const getSwapById = (id: string): SwapRecord | undefined => {
  return swapStore.get(id);
};

export const listSwaps = (filter?: {
  source_asset?: string | undefined;
  dest_asset?: string | undefined;
  limit?: number | undefined;
}): SwapRecord[] => {
  let items = Array.from(swapStore.values());
  if (filter?.source_asset) {
    items = items.filter((s) => s.source_asset === filter.source_asset);
  }
  if (filter?.dest_asset) {
    items = items.filter((s) => s.dest_asset === filter.dest_asset);
  }
  // Newest first
  items.sort((a, b) => b.createdAt - a.createdAt);
  const limit = Math.max(1, Math.min(filter?.limit ?? 100, 1000));
  return items.slice(0, limit);
};
