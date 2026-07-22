/**
 * Durable pause-state persistence helpers.
 *
 * Persists the service pause flag to a small JSON file so the state
 * survives process restarts. The file path defaults to
 * `PAUSE_STATE_FILE` env var, or `.pause_state.json` in the process
 * working directory. All I/O is synchronous and intentionally tiny
 * so startup never blocks on async resolution.
 *
 * When the file does not exist or is malformed the helpers degrade
 * gracefully to `false` (unpaused) so a corrupted file never bricks
 * the service — operators can always recover via `POST /api/v1/admin/unpause`.
 *
 * @module pauseState
 */

import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Resolve the path used to persist the pause flag.
 *
 * Reads `PAUSE_STATE_FILE` from the environment; falls back to
 * `.pause_state.json` next to the process working directory.
 *
 * @returns Absolute path to the pause-state file.
 */
export const pauseStateFilePath = (): string => {
  if (process.env.PAUSE_STATE_FILE) {
    return resolve(process.env.PAUSE_STATE_FILE);
  }
  const suffix = process.env.JEST_WORKER_ID
    ? `-${process.env.JEST_WORKER_ID}`
    : "";
  return resolve(`.pause_state${suffix}.json`);
};

/**
 * Read the persisted pause flag from disk.
 *
 * Returns `false` when the file is absent, unreadable, or contains
 * anything other than `{ "paused": true }`. This ensures the service
 * starts in the unpaused (safe) state whenever durable state is unclear.
 *
 * @returns The persisted `paused` boolean, defaulting to `false` on error.
 */
export const loadPausedState = (): boolean => {
  try {
    const raw = readFileSync(pauseStateFilePath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "paused" in parsed &&
      typeof (parsed as { paused: unknown }).paused === "boolean"
    ) {
      return (parsed as { paused: boolean }).paused;
    }
    return false;
  } catch {
    return false;
  }
};

/**
 * Persist the pause flag to disk.
 *
 * Writes `{ "paused": <value> }` to the state file when `value` is
 * `true`; removes the file when `value` is `false` so a clean restart
 * (no file) is equivalent to unpaused.
 *
 * Errors are swallowed with a `console.error` warning so a read-only
 * filesystem never prevents the in-process flag from taking effect.
 *
 * @param value - The new pause state to persist.
 */
export const savePausedState = (value: boolean): void => {
  const filePath = pauseStateFilePath();
  try {
    if (value) {
      writeFileSync(filePath, JSON.stringify({ paused: true }), "utf8");
    } else {
      try {
        unlinkSync(filePath);
      } catch {
        // File may not exist when transitioning from false→false; ignore.
      }
    }
  } catch (err) {
    console.error("[pauseState] failed to persist pause state:", err);
  }
};
