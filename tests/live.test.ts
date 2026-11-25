/**
 * Read-only checks against the public QoreChain testnet (qorechain-diana).
 * Run with: npm run test:live   (skipped in plain `npm test`).
 */
import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { deriveUnifiedAccount } from "@qorechain/sdk";
import { classicalKeyFromPrivate, fromHex, signMessage } from "@qorechain/qoresign";
import { inspectTransaction, resolveSignBytesVersion } from "@qorechain/qoresign/network";
import { describe, expect, it } from "vitest";

import { buildProofCard, verifyProofCard } from "../src/lib/proof";
import { createReceipt, signingMessage } from "../src/lib/receipt";

const REST = process.env.QORE_REST_URL ?? "https://api-testnet.qore.host";
const CHAIN = "qorechain-diana";
// A public hybrid-signed MsgSend on the testnet (someone else's), used as a read-back fixture.
const KNOWN_PQC_TX = process.env.QRG_KNOWN_TX ?? "75C5B0368ED4AA6A12BDE670810BEFCC1380079A5BC61252806C806CB8E3E9A5";

describe.skipIf(!process.env.QRG_LIVE)("live testnet read-back", () => {
  it("network verifies v2 hybrid sign-bytes", async () => {
    expect(await resolveSignBytesVersion({ rest: REST, chainId: CHAIN })).toBe("v2");
  }, 30_000);

  it("reads a committed hybrid tx and confirms its ML-DSA-87 layer against the registered key", async () => {
    const tx = await inspectTransaction({ rest: REST, txhash: KNOWN_PQC_TX, chainId: CHAIN });
    expect(tx?.code).toBe(0);
    expect(tx?.tier).toBe("pqc");
    expect(tx?.pqLayer.verified).toBe(true);
    expect(tx?.classicalSignatureValid).toBe(true);
  }, 30_000);

  it("a card pointing at someone else's tx fails the memo and signer checks", async () => {
    const acc = await deriveUnifiedAccount(generateMnemonic(wordlist, 128));
    const r = createReceipt({ title: "steal an anchor" }, { issuer: acc.cosmos });
    const sig = signMessage({ chainId: CHAIN, signer: acc.cosmos, data: signingMessage(r), classicalKey: classicalKeyFromPrivate(fromHex(acc.privateKey.slice(2)), "eth_secp256k1"), pqKey: acc.pqc });
    const card = buildProofCard({ receipt: r, signature: sig, anchor: { txhash: KNOWN_PQC_TX, chainId: CHAIN } });
    const report = await verifyProofCard(card, { rest: REST });
    const by = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(report.ok).toBe(false);
    expect(by.anchor.status).toBe("pass");
    expect(by["anchor-pq"].status).toBe("pass");
    expect(by["anchor-memo"].status).toBe("fail");
    expect(by["anchor-signer"].status).toBe("fail");
    // A fresh account has no ML-DSA-87 key on chain, so the chain-backed check refuses it.
    expect(by.signature.status).toBe("fail");
    expect(by.signature.detail).toMatch(/KEY_NOT_REGISTERED/);
  }, 60_000);
});
