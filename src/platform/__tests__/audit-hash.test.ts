import { describe, expect, it } from "vitest";
import { canonicalJSON, computeAuditHash, GENESIS_HASH } from "../audit";
import { maskValue } from "../mask";

describe("canonicalJSON", () => {
  it("is independent of key order", () => {
    expect(canonicalJSON({ b: 1, a: { d: 2, c: [3, { f: 1, e: 2 }] } })).toBe(canonicalJSON({ a: { c: [3, { e: 2, f: 1 }], d: 2 }, b: 1 }));
  });
  it("normalises bigint, Date and undefined", () => {
    expect(canonicalJSON({ s: BigInt(5), d: new Date(0), u: undefined })).toBe('{"d":"1970-01-01T00:00:00.000Z","s":"5"}');
  });
});

describe("computeAuditHash", () => {
  const base = {
    id: "id1",
    seq: BigInt(1),
    actorId: "u1",
    action: "x.y",
    entityType: "T",
    entityId: "e1",
    before: null,
    after: { a: 1 },
    reason: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    prevHash: GENESIS_HASH,
  };
  it("changes when any field changes", () => {
    const h = computeAuditHash(base);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(computeAuditHash({ ...base, after: { a: 2 } })).not.toBe(h);
    expect(computeAuditHash({ ...base, prevHash: "1".repeat(64) })).not.toBe(h);
    expect(computeAuditHash({ ...base, reason: "x" })).not.toBe(h);
  });
});

describe("maskValue", () => {
  it("shows only the last 4 chars", () => {
    expect(maskValue("P12345678")).toBe("•••••5678");
    expect(maskValue("1234")).toBe("••••");
    expect(maskValue(null)).toBe("");
  });
});
