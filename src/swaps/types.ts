/**
 * Domain types for swap execution and state tracking.
 *
 * @module swaps/types
 */

export interface SwapRecord {
  id: string;
  source_asset: string;
  dest_asset: string;
  amount: string;
  estimated_rate: string;
  route: string[];
  feeBps: number;
  feeAmount: string;
  netAmount: string;
  slippage_bps: number;
  min_received: string;
  recipient?: string;
  status: "completed";
  createdAt: number;
}

export interface CreateSwapRequest {
  source_asset: string;
  dest_asset: string;
  amount: string;
  slippage_bps?: number;
  recipient?: string;
}
