/**
 * Proof cards and their verification.
 *
 * A proof card bundles the receipt, its fingerprint, the hybrid message
 * signature (QoreSign message-signing-v1: ADR-36 secp256k1 + ML-DSA-87) and the
 * hash of the hybrid-signed anchor transaction. Anyone can re-check it against
 * the public chain: the ML-DSA-87 half is verified against the key the issuer
 * registered on chain, never against a key carried in the card.
 */
import { verifyMessage, type MessageSignature } from "@qorechain/qoresign";
import {
  inspectTransaction,
  verifyMessageWithChain,
  type FetchLike,
} from "@qorechain/qoresign/network";

import {
  fingerprintFromMemo,
  receiptFingerprint,
  signingMessage,
  type Receipt,
} from "./receipt";

export const PROOF_TYPE = "qoresign-receipt-proof" as const;

export interface AnchorRef {
  txhash: string;
  height?: string;
  chainId: string;
}

export interface ProofCard {
  type: typeof PROOF_TYPE;
  version: 1;
  receipt: Receipt;
  receiptSha256: string;
  message: string;
  signature: MessageSignature;
  anchor?: AnchorRef;
  createdWith: string;
}

export function buildProofCard(args: {
  receipt: Receipt;
  signature: MessageSignature;
  anchor?: AnchorRef;
}): ProofCard {
  const fp = receiptFingerprint(args.receipt);
  return {
    type: PROOF_TYPE,
    version: 1,
    receipt: args.receipt,
    receiptSha256: fp,
    message: signingMessage(args.receipt, fp),
    signature: normaliseSignature(args.signature),
    anchor: args.anchor,
    createdWith: "qoresign-receipt-guard/0.1.0",
  };
}

/**
 * Keep only the QoreSign fields of a wallet signature. QoreX's
 * `signArbitrary` also returns Keplr-style `pub_key` / `signature` fields.
 */
export function normaliseSignature(sig: MessageSignature): MessageSignature {
  const s = sig as MessageSignature & Record<string, unknown>;
  return {
    signatureType: s.signatureType,
    classical: {
      keyType: s.classical.keyType,
      publicKey: s.classical.publicKey,
      signature: s.classical.signature,
    },
    ...(s.pq ? { pq: { algorithmId: s.pq.algorithmId, signature: s.pq.signature } } : {}),
  };
}

export type CheckStatus = "pass" | "fail" | "skip";
export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail?: string;
}
export interface VerifyReport {
  ok: boolean;
  fingerprint: string;
  checks: Check[];
}

export interface VerifyOptions {
  rest: string;
  fetch?: FetchLike;
  /** Offline mode for tests: check the ML-DSA-87 half against this key instead of the chain. */
  pqPublicKey?: Uint8Array;
  /** Skip the on-chain anchor check (e.g. a card that is not anchored yet). */
  requireAnchor?: boolean;
}

function errText(e: unknown): string {
  const err = e as { code?: string; message?: string };
  return err?.code ? `${err.code}: ${err.message}` : String(err?.message ?? e);
}

export async function verifyProofCard(card: ProofCard, opts: VerifyOptions): Promise<VerifyReport> {
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  if (card?.type !== PROOF_TYPE || card.version !== 1) {
    add({ id: "format", label: "Proof card format", status: "fail", detail: "not a qoresign-receipt-proof v1" });
    return { ok: false, fingerprint: "", checks };
  }
  const receipt = card.receipt;
  const fp = receiptFingerprint(receipt);
  add({
    id: "fingerprint",
    label: "Receipt fingerprint (SHA-256) matches the card",
    status: fp === card.receiptSha256 ? "pass" : "fail",
    detail: fp === card.receiptSha256 ? fp : `recomputed ${fp}, card says ${card.receiptSha256}`,
  });
  const expectedMsg = signingMessage(receipt, fp);
  add({
    id: "message",
    label: "Signed text is bound to this receipt",
    status: expectedMsg === card.message ? "pass" : "fail",
  });

  // Hybrid message signature.
  try {
    if (opts.pqPublicKey) {
      verifyMessage({
        chainId: receipt.chainId,
        signer: receipt.issuer,
        data: expectedMsg,
        signature: card.signature,
        pqPublicKey: opts.pqPublicKey,
      });
      add({ id: "signature", label: "Hybrid signature (secp256k1 + ML-DSA-87)", status: "pass", detail: "checked offline against the supplied ML-DSA-87 key" });
    } else {
      const r = await verifyMessageWithChain({
        rest: opts.rest,
        fetch: opts.fetch,
        chainId: receipt.chainId,
        signer: receipt.issuer,
        data: expectedMsg,
        signature: card.signature,
      });
      add({
        id: "signature",
        label: "Hybrid signature (secp256k1 + ML-DSA-87) vs key registered on chain",
        status: "pass",
        detail: r.possessionProven ? "registered key has a proof of possession" : "registered key (no proof of possession recorded)",
      });
    }
  } catch (e) {
    add({ id: "signature", label: "Hybrid signature (secp256k1 + ML-DSA-87)", status: "fail", detail: errText(e) });
  }

  // On-chain anchor.
  if (!card.anchor) {
    add({
      id: "anchor",
      label: "Anchor transaction on QoreChain",
      status: opts.requireAnchor === false ? "skip" : "fail",
      detail: "card has no anchor",
    });
  } else {
    try {
      const tx = await inspectTransaction({
        rest: opts.rest,
        fetch: opts.fetch,
        txhash: card.anchor.txhash,
        chainId: card.anchor.chainId,
      });
      if (!tx) {
        add({ id: "anchor", label: "Anchor transaction found", status: "fail", detail: "unknown tx hash" });
      } else {
        add({ id: "anchor", label: `Anchor tx found (height ${tx.height})`, status: tx.code === 0 ? "pass" : "fail", detail: tx.code === 0 ? tx.txhash : `code ${tx.code} ${tx.codespace}` });
        const memoFp = fingerprintFromMemo(tx.memo);
        add({ id: "anchor-memo", label: "Anchor memo carries this fingerprint", status: memoFp === fp ? "pass" : "fail", detail: tx.memo || "(empty memo)" });
        add({ id: "anchor-signer", label: "Anchor signed by the receipt issuer", status: tx.signer?.address === receipt.issuer ? "pass" : "fail", detail: tx.signer?.address });
        add({
          id: "anchor-pq",
          label: "Anchor tx carries a verified ML-DSA-87 layer (tier pqc)",
          status: tx.tier === "pqc" && tx.pqLayer.verified === true ? "pass" : "fail",
          detail: `tier=${tx.tier}, layer present=${tx.pqLayer.present}, verified=${tx.pqLayer.verified}${tx.pqLayer.reason ? `, ${tx.pqLayer.reason}` : ""}`,
        });
      }
    } catch (e) {
      add({ id: "anchor", label: "Anchor transaction on QoreChain", status: "fail", detail: errText(e) });
    }
  }

  const ok = checks.every((c) => c.status !== "fail");
  return { ok, fingerprint: fp, checks };
}

/** JSON with bigint support, for reports. */
export function toJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}
