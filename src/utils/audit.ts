import { recordEvent } from "../stores";

export function auditLog(action: string, details?: Record<string, unknown>) {
  try {
    return recordEvent(action as any, details ?? {});
  } catch {
    // Audit logging should never break the main flow
    return null;
  }
}
