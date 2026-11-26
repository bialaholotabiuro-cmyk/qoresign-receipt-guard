#!/usr/bin/env -S npx tsx
/**
 * qrg - QoreSign Receipt Guard command line (TESTNET qorechain-diana only).
 *
 *   npm run cli -- wallet:new            make a throwaway testnet wallet (file outside the repo)
 *   npm run cli -- status                address forms, balance, PQC key status
 *   npm run cli -- register              register the ML-DSA-87 key (one time, needs test QOR)
 *   npm run cli -- issue --title "..." [--amount 12.50 --currency fUSD --counterparty qor1... --note "..."]
 *                                        receipt -> hybrid signature -> hybrid-signed anchor tx -> proof card
 *   npm run cli -- send-proof --memo "<memo>"
 *                                        hybrid-signed 1 uqor self-send with exactly that memo (wallet proof on build.qorechain.io)
 *   npm run cli -- demo-offline          same flow fully offline (no funds needed): sign + verify locally
 *   npm run cli -- verify <proof.json>   re-check a proof card against the public chain
 *   npm run cli -- inspect <txhash>      read any tx and show its ML-DSA-87 layer / tier
 *   npm run cli -- addr <qor1...|0x...>  show both forms of an address
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { inspectTransaction } from "@qorechain/qoresign/network";

import { buildProofCard, toJson, verifyProofCard, type ProofCard, type VerifyReport } from "../src/lib/proof";
import { addressForms, createReceipt, receiptFingerprint, signingMessage } from "../src/lib/receipt";
import {
  accountInfo,
  anchorFingerprint,
  balances,
  createWallet,
  loadAccount,
  pqStatus,
  registerPqKey,
  sendSelfMemo,
  signReceiptMessage,
  TESTNET,
  WALLET_PATH,
} from "./chain";

function flags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[key] = "true";
      else { out[key] = next; i++; }
    }
  }
  return out;
}

function printReport(r: VerifyReport) {
  const icon = { pass: "PASS", fail: "FAIL", skip: "SKIP" } as const;
  for (const c of r.checks) console.log(`  [${icon[c.status]}] ${c.label}${c.detail ? `\n         ${c.detail}` : ""}`);
  console.log(r.ok ? "\nRESULT: receipt is authentic and untampered." : "\nRESULT: verification FAILED.");
}

function saveProof(card: ProofCard, suffix = ""): string {
  const dir = resolve(process.cwd(), "proofs");
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, `${card.receiptSha256.slice(0, 16)}${suffix}.json`);
  writeFileSync(path, toJson(card) + "\n");
  return path;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const f = flags(rest);
  switch (cmd) {
    case "wallet:new": {
      createWallet(f.force === "true");
      const acc = await loadAccount();
      console.log(`New TESTNET-only wallet written to ${WALLET_PATH} (mode 600, outside the git repo).`);
      console.log(`qor1: ${acc.cosmos}\n0x:   ${acc.evm}`);
      console.log("Fund it at https://dashboard.qorechain.io/faucet (sign-in required), then: npm run cli -- register");
      return;
    }
    case "status": {
      const acc = await loadAccount();
      const [info, bal, pq] = await Promise.all([accountInfo(acc.cosmos), balances(acc.cosmos), pqStatus(acc.cosmos)]);
      console.log(`network:  ${TESTNET.chainId} (${TESTNET.rest})`);
      console.log(`account:  ${acc.cosmos}  (${acc.evm})`);
      console.log(`on chain: ${info.exists ? `yes, account #${info.accountNumber}, sequence ${info.sequence}` : "no (fund from faucet)"}`);
      // uqor first; other denoms (faucet erc20 tokens) are summarised unless --all is given
      const shown = f.all === "true" ? bal : bal.filter((b) => b.denom === "uqor");
      const hidden = bal.length - shown.length;
      console.log(`balances: ${shown.length ? shown.map((b) => `${b.amount} ${b.denom}`).join(", ") : "(none)"}${hidden > 0 ? `  (+${hidden} other tokens, use --all)` : ""}`);
      console.log(`PQC key:  ${pq.registered ? `registered (${pq.keyType}, possession proven: ${pq.possessionProven})` : "not registered (run: npm run cli -- register)"}`);
      return;
    }
    case "register": {
      const acc = await loadAccount();
      const r = await registerPqKey(acc);
      console.log(r.alreadyRegistered ? "ML-DSA-87 key already registered; nothing sent." : `registered: ${r.txhash} (height ${r.height})`);
      return;
    }
    case "issue": {
      const acc = await loadAccount();
      const receipt = createReceipt(
        { title: f.title ?? "", amount: f.amount, currency: f.currency, counterparty: f.counterparty, note: f.note },
        { issuer: acc.cosmos, chainId: TESTNET.chainId },
      );
      const fp = receiptFingerprint(receipt);
      console.log(`receipt sha256: ${fp}`);
      const signature = signReceiptMessage(acc, receipt.chainId, signingMessage(receipt, fp));
      console.log(`signed: ${signature.signatureType} (ML-DSA-87 ${Buffer.from(signature.pq!.signature, "base64").length} bytes)`);
      const a = await anchorFingerprint(acc, fp);
      console.log(`anchored: ${a.txhash} at height ${a.height} (hybrid, sign-bytes ${a.signBytesVersion}, gas ${a.gas})`);
      const card = buildProofCard({ receipt, signature, anchor: { txhash: a.txhash, height: a.height.toString(), chainId: TESTNET.chainId } });
      const path = saveProof(card);
      console.log(`proof card: ${path}\nexplorer:   ${TESTNET.explorer} (Testnet) -> ${a.txhash}\n`);
      printReport(await verifyProofCard(card, { rest: TESTNET.rest }));
      return;
    }
    case "send-proof": {
      const memo = f.memo;
      if (!memo || memo === "true") throw new Error('usage: send-proof --memo "<memo>"');
      const acc = await loadAccount();
      const a = await sendSelfMemo(acc, memo);
      console.log(`memo:   ${memo}\ntxHash: ${a.txhash}\nheight: ${a.height} (code ${a.code}, hybrid, sign-bytes ${a.signBytesVersion}, gas ${a.gas})`);
      console.log(`explorer: ${TESTNET.explorer} (Testnet) -> ${a.txhash}`);
      return;
    }
    case "demo-offline": {
      // Full sign/verify/tamper demo without funds: uses the local wallet keys only.
      const acc = await loadAccount();
      const receipt = createReceipt(
        { title: f.title ?? "Invoice #2026-001 - logo design", amount: f.amount ?? "250.00", currency: f.currency ?? "fUSD", note: f.note ?? "offline demo" },
        { issuer: acc.cosmos, chainId: TESTNET.chainId },
      );
      const signature = signReceiptMessage(acc, receipt.chainId, signingMessage(receipt));
      const card = buildProofCard({ receipt, signature });
      const path = saveProof(card, ".offline");
      console.log(`proof card (not anchored): ${path}\n\nVerify original:`);
      printReport(await verifyProofCard(card, { rest: TESTNET.rest, pqPublicKey: acc.pqc.publicKey, requireAnchor: false }));
      const tampered: ProofCard = { ...card, receipt: { ...card.receipt, amount: "2500.00" } };
      console.log(`\nVerify tampered copy (amount 250.00 -> 2500.00):`);
      printReport(await verifyProofCard(tampered, { rest: TESTNET.rest, pqPublicKey: acc.pqc.publicKey, requireAnchor: false }));
      return;
    }
    case "verify": {
      const file = rest.find((a) => !a.startsWith("--"));
      if (!file) throw new Error("usage: verify <proof.json>");
      const card = JSON.parse(readFileSync(file, "utf8")) as ProofCard;
      printReport(await verifyProofCard(card, { rest: TESTNET.rest, requireAnchor: f["no-anchor"] !== "true" }));
      return;
    }
    case "inspect": {
      const hash = rest[0];
      const tx = await inspectTransaction({ rest: TESTNET.rest, txhash: hash, chainId: TESTNET.chainId });
      console.log(tx ? toJson({ ...tx, messages: tx.messages.map((m) => m.typeUrl) }) : "not found");
      return;
    }
    case "addr": {
      console.log(addressForms(rest[0]));
      return;
    }
    default:
      console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(2, 17).join("\n"));
  }
}

main().catch((e) => {
  console.error(`error: ${e?.code ? `${e.code}: ` : ""}${e?.message ?? e}`);
  if (e?.details) console.error(toJson(e.details));
  process.exit(1);
});
