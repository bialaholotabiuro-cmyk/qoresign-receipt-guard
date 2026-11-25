import { describe, expect, it } from "vitest";

import {
  addressForms,
  anchorMemo,
  canonicalJson,
  createReceipt,
  fingerprintFromMemo,
  receiptFingerprint,
  signingMessage,
} from "../src/lib/receipt";

const ISSUER = "qor1jx6z8y3zh8x0veuhun6lwcwqfx8st7n9us4z43";
const ISSUER_HEX = "0x91b4239222B9cCF66797e4F5f761c0498F05FA65";
const fixed = { issuer: ISSUER, now: new Date("2026-11-26T10:00:00Z"), nonce: "00112233445566778899aabbccddeeff" };

describe("receipt model", () => {
  it("canonical JSON is key-order independent and drops empty fields", () => {
    expect(canonicalJson({ b: 1, a: { d: "x", c: [2, 1] }, e: undefined, f: "" })).toBe('{"a":{"c":[2,1],"d":"x"},"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it("fingerprint is stable and changes on any edit", () => {
    const r = createReceipt({ title: "Invoice 7", amount: "125.50", currency: "fUSD" }, fixed);
    const fp = receiptFingerprint(r);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(receiptFingerprint({ ...r })).toBe(fp);
    expect(receiptFingerprint({ ...r, amount: "125.51" })).not.toBe(fp);
    expect(receiptFingerprint({ ...r, title: "Invoice 8" })).not.toBe(fp);
    expect(receiptFingerprint({ ...r, chainId: "qorechain-vladi" })).not.toBe(fp);
  });

  it("two otherwise identical receipts differ by nonce", () => {
    const a = createReceipt({ title: "x" }, { issuer: ISSUER });
    const b = createReceipt({ title: "x" }, { issuer: ISSUER });
    expect(receiptFingerprint(a)).not.toBe(receiptFingerprint(b));
  });

  it("validates input and normalises a 0x issuer to qor1", () => {
    expect(() => createReceipt({ title: "  " }, fixed)).toThrow(/title/);
    expect(() => createReceipt({ title: "t", amount: "12,5" }, fixed)).toThrow(/Amount/);
    expect(createReceipt({ title: "t" }, { ...fixed, issuer: ISSUER_HEX }).issuer).toBe(ISSUER);
    expect(() => createReceipt({ title: "t" }, { ...fixed, issuer: "cosmos1abc" })).toThrow();
  });

  it("signing text binds chain, issuer and fingerprint", () => {
    const r = createReceipt({ title: "t" }, fixed);
    const msg = signingMessage(r);
    expect(msg).toContain("chain: qorechain-diana");
    expect(msg).toContain(`issuer: ${ISSUER}`);
    expect(msg).toContain(receiptFingerprint(r));
    expect(new TextEncoder().encode(msg).length).toBeLessThanOrEqual(4096);
  });

  it("anchor memo round-trips and rejects junk", () => {
    const fp = "ab".repeat(32);
    expect(anchorMemo(fp)).toBe(`qrg1:${fp}`);
    expect(anchorMemo(fp).length).toBeLessThanOrEqual(256);
    expect(fingerprintFromMemo(anchorMemo(fp))).toBe(fp);
    expect(fingerprintFromMemo("hello")).toBeUndefined();
    expect(() => anchorMemo("XYZ")).toThrow();
  });

  it("address helper maps qor1 <-> 0x (same 20 bytes)", () => {
    expect(addressForms(ISSUER).hex).toBe(ISSUER_HEX);
    expect(addressForms(ISSUER_HEX).qor).toBe(ISSUER);
  });
});
