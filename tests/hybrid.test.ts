import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { deriveUnifiedAccount, EthNativeSigner, type UnifiedAccount } from "@qorechain/sdk";
import {
  classicalKeyFromPrivate,
  decodeTxRaw,
  fromHex,
  pqcLayers,
  signMessage,
  verifyHybridTx,
  type MessageSignature,
} from "@qorechain/qoresign";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";
import { TxBody } from "cosmjs-types/cosmos/tx/v1beta1/tx";
import { beforeAll, describe, expect, it } from "vitest";

import { buildProofCard, normaliseSignature, verifyProofCard } from "../src/lib/proof";
import { anchorMemo, createReceipt, fingerprintFromMemo, receiptFingerprint, signingMessage } from "../src/lib/receipt";

const CHAIN = "qorechain-diana";
const OFFLINE = { rest: "http://offline.invalid", requireAnchor: false } as const;

let alice: UnifiedAccount;
let mallory: UnifiedAccount;
const sign = (acc: UnifiedAccount, data: string): MessageSignature =>
  signMessage({
    chainId: CHAIN,
    signer: acc.cosmos,
    data,
    classicalKey: classicalKeyFromPrivate(fromHex(acc.privateKey.slice(2)), "eth_secp256k1"),
    pqKey: acc.pqc,
  });

beforeAll(async () => {
  alice = await deriveUnifiedAccount(generateMnemonic(wordlist, 128));
  mallory = await deriveUnifiedAccount(generateMnemonic(wordlist, 128));
});

describe("hybrid receipt signatures (secp256k1 + ML-DSA-87)", () => {
  it("a genuine card verifies; signature has both halves of the right size", async () => {
    const r = createReceipt({ title: "Invoice 1", amount: "10", currency: "fUSD" }, { issuer: alice.cosmos });
    const sig = sign(alice, signingMessage(r));
    expect(sig.signatureType).toBe("ml-dsa-87-hybrid");
    expect(Buffer.from(sig.pq!.signature, "base64").length).toBe(4627);
    expect(Buffer.from(sig.classical.signature, "base64").length).toBe(64);
    const report = await verifyProofCard(buildProofCard({ receipt: r, signature: sig }), { ...OFFLINE, pqPublicKey: alice.pqc.publicKey });
    expect(report.ok).toBe(true);
  });

  it("detects an edited receipt", async () => {
    const r = createReceipt({ title: "Invoice 2", amount: "10" }, { issuer: alice.cosmos });
    const card = buildProofCard({ receipt: r, signature: sign(alice, signingMessage(r)) });
    const report = await verifyProofCard({ ...card, receipt: { ...r, amount: "1000" } }, { ...OFFLINE, pqPublicKey: alice.pqc.publicKey });
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.id === "fingerprint")?.status).toBe("fail");
    expect(report.checks.find((c) => c.id === "signature")?.status).toBe("fail");
  });

  it("rejects a forged issuer (Mallory signs a receipt that names Alice)", async () => {
    const r = createReceipt({ title: "Fake" }, { issuer: alice.cosmos });
    const card = buildProofCard({ receipt: r, signature: sign(mallory, signingMessage(r)) });
    const report = await verifyProofCard(card, { ...OFFLINE, pqPublicKey: alice.pqc.publicKey });
    expect(report.ok).toBe(false);
  });

  it("rejects a valid classical half paired with the wrong ML-DSA-87 key", async () => {
    const r = createReceipt({ title: "Q-Day" }, { issuer: alice.cosmos });
    const card = buildProofCard({ receipt: r, signature: sign(alice, signingMessage(r)) });
    const report = await verifyProofCard(card, { ...OFFLINE, pqPublicKey: mallory.pqc.publicKey });
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.id === "signature")?.detail).toMatch(/PQ|pq|ML-DSA|signature/i);
  });

  it("rejects a stripped post-quantum half (downgrade attempt)", async () => {
    const r = createReceipt({ title: "Downgrade" }, { issuer: alice.cosmos });
    const sig = sign(alice, signingMessage(r));
    const stripped = { ...sig, pq: undefined } as MessageSignature;
    const report = await verifyProofCard(buildProofCard({ receipt: r, signature: stripped }), { ...OFFLINE, pqPublicKey: alice.pqc.publicKey });
    expect(report.ok).toBe(false);
  });

  it("normaliseSignature drops Keplr-style extra fields from QoreX", () => {
    const r = createReceipt({ title: "n" }, { issuer: alice.cosmos });
    const sig = { ...sign(alice, signingMessage(r)), pub_key: { type: "x", value: "y" }, signature: "zzz" } as unknown as MessageSignature;
    const n = normaliseSignature(sig) as unknown as Record<string, unknown>;
    expect(Object.keys(n).sort()).toEqual(["classical", "pq", "signatureType"]);
  });
});

describe("hybrid-signed anchor transaction (built offline, verified independently)", () => {
  it("EthNativeSigner output carries one ML-DSA-87 layer that qoresign verifies, with the receipt memo", () => {
    const r = createReceipt({ title: "Anchor me" }, { issuer: alice.cosmos });
    const fp = receiptFingerprint(r);
    const signer = new EthNativeSigner(alice, { signBytesVersion: "v2" });
    const signed = signer.sign({
      chainId: CHAIN,
      accountNumber: 42,
      sequence: 3,
      memo: anchorMemo(fp),
      messages: [{ typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: MsgSend.fromPartial({ fromAddress: alice.cosmos, toAddress: alice.cosmos, amount: [{ denom: "uqor", amount: "1" }] }) }],
      fee: { amount: [{ denom: "uqor", amount: "40000" }], gas: "400000" },
    });
    const ck = classicalKeyFromPrivate(fromHex(alice.privateKey.slice(2)), "eth_secp256k1");
    const res = verifyHybridTx({ txBytes: signed.txRawBytes, chainId: CHAIN, accountNumber: 42, classicalPublicKey: ck.publicKey, classicalKeyType: "eth_secp256k1", pqPublicKey: alice.pqc.publicKey, signBytesVersion: "v2" });
    expect(res).toMatchObject({ valid: true, classical: true, pq: { valid: true, signBytesVersion: "v2" } });

    const raw = decodeTxRaw(signed.txRawBytes);
    expect(pqcLayers(raw.bodyBytes)).toHaveLength(1);
    expect(fingerprintFromMemo(TxBody.decode(raw.bodyBytes).memo)).toBe(fp);

    // Wrong account number (replay onto another account) fails the classical half.
    expect(verifyHybridTx({ txBytes: signed.txRawBytes, chainId: CHAIN, accountNumber: 43, classicalPublicKey: ck.publicKey, classicalKeyType: "eth_secp256k1", pqPublicKey: alice.pqc.publicKey, signBytesVersion: "v2" }).valid).toBe(false);
    // Another account's ML-DSA-87 key fails the PQ half.
    expect(verifyHybridTx({ txBytes: signed.txRawBytes, chainId: CHAIN, accountNumber: 42, classicalPublicKey: ck.publicKey, classicalKeyType: "eth_secp256k1", pqPublicKey: mallory.pqc.publicKey, signBytesVersion: "v2" }).pq?.valid).toBe(false);
  });
});
