/**
 * QoreSign Receipt Guard - receipt model.
 *
 * A receipt is a small JSON document. Its fingerprint is the SHA-256 of the
 * canonical JSON (keys sorted, no whitespace), so any edit to any field gives a
 * different fingerprint. The fingerprint is what gets hybrid-signed
 * (secp256k1 + ML-DSA-87) and anchored on QoreChain in a transaction memo.
 */
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, randomBytes, utf8ToBytes } from "@noble/hashes/utils";
import { parseAddress } from "@qorechain/qoresign";

export const RECEIPT_VERSION = "qrg/1" as const;
export const DEFAULT_CHAIN_ID = "qorechain-diana";
/** Memo prefix of an anchor transaction: `qrg1:<64 hex>` (69 bytes, under the 256-byte memo cap). */
export const ANCHOR_MEMO_PREFIX = "qrg1:";

export interface ReceiptInput {
  title: string;
  amount?: string;
  currency?: string;
  counterparty?: string;
  note?: string;
}

export interface Receipt extends ReceiptInput {
  v: typeof RECEIPT_VERSION;
  chainId: string;
  /** `qor1...` account that issues and signs the receipt. */
  issuer: string;
  /** ISO-8601 UTC timestamp. */
  issuedAt: string;
  /** 128-bit random nonce, so two identical receipts never share a fingerprint. */
  nonce: string;
}

/** Deterministic JSON: object keys sorted, `undefined` and empty strings dropped. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined && obj[k] !== "")
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export function receiptFingerprint(receipt: Receipt): string {
  return bytesToHex(sha256(utf8ToBytes(canonicalJson(receipt))));
}

/** Normalise an issuer given as `qor1...` or `0x...` to its `qor1` form. */
export function normaliseAccount(address: string): string {
  return parseAddress(address.trim()).bech32;
}

export function createReceipt(
  input: ReceiptInput,
  opts: { issuer: string; chainId?: string; now?: Date; nonce?: string },
): Receipt {
  const title = input.title?.trim();
  if (!title) throw new Error("A receipt needs a title.");
  if (title.length > 200) throw new Error("Title is limited to 200 characters.");
  if (input.amount !== undefined && input.amount !== "" && !/^\d+(\.\d{1,18})?$/.test(input.amount.trim())) {
    throw new Error("Amount must be a plain decimal number, for example 125.50.");
  }
  const receipt: Receipt = {
    v: RECEIPT_VERSION,
    chainId: opts.chainId ?? DEFAULT_CHAIN_ID,
    issuer: normaliseAccount(opts.issuer),
    issuedAt: (opts.now ?? new Date()).toISOString(),
    nonce: opts.nonce ?? bytesToHex(randomBytes(16)),
    title,
    amount: input.amount?.trim() || undefined,
    currency: input.currency?.trim() || undefined,
    counterparty: input.counterparty?.trim() || undefined,
    note: input.note?.trim() || undefined,
  };
  if (canonicalJson(receipt).length > 3000) throw new Error("Receipt is too large (max ~3000 bytes).");
  return receipt;
}

/**
 * The exact text the wallet signs. It names the app, the chain and the
 * fingerprint, so the signature cannot be replayed as a login on another site.
 * QoreX prefixes the ML-DSA-87 half with `qorechain-msg-v1|<chainId>|`.
 */
export function signingMessage(receipt: Receipt, fingerprint = receiptFingerprint(receipt)): string {
  return [
    "QoreSign Receipt Guard - I issue this receipt.",
    `chain: ${receipt.chainId}`,
    `issuer: ${receipt.issuer}`,
    `receipt-sha256: ${fingerprint}`,
  ].join("\n");
}

export function anchorMemo(fingerprint: string): string {
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) throw new Error("fingerprint must be 64 lowercase hex chars");
  return `${ANCHOR_MEMO_PREFIX}${fingerprint}`;
}

export function fingerprintFromMemo(memo: string): string | undefined {
  const m = /^qrg1:([0-9a-f]{64})$/.exec(memo.trim());
  return m?.[1];
}

/** Both forms of one QoreChain account (the same 20 bytes). */
export function addressForms(address: string): { qor: string; hex: string } {
  const a = parseAddress(address.trim());
  return { qor: a.bech32, hex: a.hex };
}
