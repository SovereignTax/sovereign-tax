import { describe, it, expect } from "vitest";
import { capAuditLog, AUDIT_LOG_MAX, createAuditEntry, AuditAction } from "../audit";

// ═══════════════════════════════════════════════════════
// BATCH D5 — audit log rotation
// ═══════════════════════════════════════════════════════

describe("D5 — capAuditLog rotation", () => {
  const make = (n: number) =>
    Array.from({ length: n }, (_, i) => createAuditEntry(AuditAction.AppUnlocked, `e${i}`));

  it("returns the same array unchanged when within the cap", () => {
    const entries = make(10);
    expect(capAuditLog(entries, 5000)).toBe(entries);
  });

  it("keeps only the most recent N when over the cap, dropping the oldest", () => {
    const entries = make(5005);
    const capped = capAuditLog(entries, 5000);
    expect(capped).toHaveLength(5000);
    expect(capped[0].details).toBe("e5"); // oldest 5 dropped
    expect(capped[capped.length - 1].details).toBe("e5004"); // newest kept
  });

  it("defaults to AUDIT_LOG_MAX (5000)", () => {
    expect(AUDIT_LOG_MAX).toBe(5000);
    expect(capAuditLog(make(AUDIT_LOG_MAX + 3))).toHaveLength(AUDIT_LOG_MAX);
  });

  it("handles an empty log and exact-cap boundary without copying", () => {
    const empty: ReturnType<typeof make> = [];
    expect(capAuditLog(empty)).toBe(empty);
    const exact = make(5000);
    expect(capAuditLog(exact, 5000)).toBe(exact); // exactly at cap → no rotation
  });
});
