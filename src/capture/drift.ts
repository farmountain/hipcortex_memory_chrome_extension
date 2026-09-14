/**
 * The drift counter — turning "capture stopped working" into "capture from ChatGPT needs updating,
 * the messageText slot stopped resolving".
 *
 * Provider DOM is the one input in this system that changes without anyone asking. It does not fail
 * loudly: a selector stops matching, extraction fails closed with a typed code, and the user sees
 * nothing captured and has no idea which side is broken. This file counts those typed failures per
 * provider so the surfaces can say which provider and which *slot* — or which rung of which ladder —
 * is the failing part (G8.6).
 *
 * Only typed extraction failures count. A transport failure is a delivery problem (the runtime is
 * down) and counting it here would blame the adapter for an outage.
 */

import { byId } from "./providers/registry.js";
import type { CaptureSlot } from "./providers/types.js";

export const DRIFT_STORAGE_KEY = "hipcortex.capture.drift";

/** Consecutive failures before the provider is reported as needing attention. */
export const DRIFT_THRESHOLD = 3;

export interface DriftSignal {
  readonly providerId: string;
  readonly code: string;
  readonly slot?: CaptureSlot;
  readonly rung?: number;
}

export interface DriftRecord extends DriftSignal {
  readonly consecutiveFailures: number;
  readonly updatedAt: string;
}

export interface DriftStatus {
  readonly providerId: string;
  readonly needsAttention: boolean;
  readonly consecutiveFailures: number;
  /** Set only at or past the threshold. Names the provider and the failing slot or rung. */
  readonly message: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDriftRecord(value: unknown): value is DriftRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value["providerId"] === "string" &&
    typeof value["code"] === "string" &&
    typeof value["consecutiveFailures"] === "number" &&
    value["consecutiveFailures"] > 0 &&
    typeof value["updatedAt"] === "string" &&
    (value["slot"] === undefined || typeof value["slot"] === "string") &&
    (value["rung"] === undefined || typeof value["rung"] === "number")
  );
}

export function displayNameFor(providerId: string): string {
  return byId(providerId)?.displayName ?? providerId;
}

/**
 * The text a surface shows.
 *
 * It names the failing *part*, because "capture is broken" is not actionable for anyone. A rung of
 * `-1` means no rung of that ladder resolved at all, which is a missing-selector problem; a rung of
 * `0` or more means the shape moved inside a container that still exists.
 */
export function describeDrift(record: DriftRecord): string {
  const name = displayNameFor(record.providerId);
  const slot = record.slot ? `"${record.slot}" slot` : "conversation layout";
  const rung =
    typeof record.rung === "number"
      ? record.rung >= 0
        ? ` (selector rung ${record.rung})`
        : " (no selector rung matched)"
      : "";

  return (
    `Capture from ${name} needs updating: the ${slot} failed ${record.consecutiveFailures} times ` +
    `in a row (${record.code})${rung}.`
  );
}

export function toStatus(record: DriftRecord | null, providerId: string): DriftStatus {
  if (!record || record.consecutiveFailures < DRIFT_THRESHOLD) {
    return {
      providerId,
      needsAttention: false,
      consecutiveFailures: record?.consecutiveFailures ?? 0,
      message: null,
    };
  }
  return {
    providerId,
    needsAttention: true,
    consecutiveFailures: record.consecutiveFailures,
    message: describeDrift(record),
  };
}

async function readStore(): Promise<Record<string, DriftRecord>> {
  const stored = await chrome.storage.local.get(DRIFT_STORAGE_KEY);
  const value = stored[DRIFT_STORAGE_KEY];
  if (!isRecord(value)) return {};

  const store: Record<string, DriftRecord> = {};
  for (const [providerId, record] of Object.entries(value)) {
    if (isDriftRecord(record)) store[providerId] = record;
  }
  return store;
}

export async function readDrift(): Promise<readonly DriftRecord[]> {
  const store = await readStore();
  return Object.values(store);
}

/** Consecutive typed failures per provider, newest value per provider (never appended). */
export async function recordDriftFailure(signal: DriftSignal, now: Date = new Date()): Promise<DriftStatus> {
  const store = await readStore();
  const previous = store[signal.providerId];
  const record: DriftRecord = {
    providerId: signal.providerId,
    code: signal.code,
    slot: signal.slot,
    rung: signal.rung,
    consecutiveFailures: (previous?.consecutiveFailures ?? 0) + 1,
    updatedAt: now.toISOString(),
  };

  await chrome.storage.local.set({ [DRIFT_STORAGE_KEY]: { ...store, [signal.providerId]: record } });
  return toStatus(record, signal.providerId);
}

/** A success clears the state: the provider is working, whatever it was doing before. */
export async function recordDriftSuccess(providerId: string): Promise<DriftStatus> {
  const store = await readStore();
  if (store[providerId]) {
    const next = { ...store };
    delete next[providerId];
    await chrome.storage.local.set({ [DRIFT_STORAGE_KEY]: next });
  }
  return toStatus(null, providerId);
}

export async function driftStatuses(): Promise<readonly DriftStatus[]> {
  const records = await readDrift();
  return records.map((record) => toStatus(record, record.providerId));
}
