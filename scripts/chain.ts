/**
 * Node-side QoreChain helpers for the CLI: a TESTNET-only throwaway wallet,
 * account reads, PQC key registration and hybrid-signed anchor transactions.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import {
  buildRegisterPqcKeyMsg,
  deriveUnifiedAccount,
  EthNativeSigner,
  signProofOfPossession,
  type UnifiedAccount,
} from "@qorechain/sdk";
import { classicalKeyFromPrivate, fromHex, signMessage, type MessageSignature } from "@qorechain/qoresign";
import {
  broadcastTx,
  fetchPqKeyStatus,
  hasExactSimulation,
  inspectTransaction,
  simulateTx,
} from "@qorechain/qoresign/network";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";

import { anchorMemo } from "../src/lib/receipt";

export const TESTNET = {
  chainId: "qorechain-diana",
  rest: process.env.QORE_REST_URL ?? "https://api-testnet.qore.host",
  gasPriceUqor: 0.1,
  explorer: "https://explore.qore.network",
} as const;

export const WALLET_PATH = resolve(
  process.env.QRG_WALLET ?? resolve(process.cwd(), "..", "testnet-wallet", "qrg-testnet.wallet.json"),
);

interface WalletFile {
  warning: string;
  network: "testnet";
  chainId: string;
  mnemonic: string;
  address: string;
  evm: string;
  createdAt: string;
}

export function createWallet(force = false): WalletFile {
  if (existsSync(WALLET_PATH) && !force) throw new Error(`wallet exists: ${WALLET_PATH} (use --force to replace)`);
  const mnemonic = generateMnemonic(wordlist, 128);
  return writeWallet(mnemonic);
}

function writeWallet(mnemonic: string): WalletFile {
  // derive synchronously-ish: deriveUnifiedAccount is async, so the caller awaits loadAccount after.
  const file: WalletFile = {
    warning: "THROWAWAY TESTNET ACCOUNT (qorechain-diana). Never fund with real assets. Never commit.",
    network: "testnet",
    chainId: TESTNET.chainId,
    mnemonic,
    address: "",
    evm: "",
    createdAt: new Date().toISOString(),
  };
  mkdirSync(dirname(WALLET_PATH), { recursive: true });
  writeFileSync(WALLET_PATH, JSON.stringify(file, null, 2), { mode: 0o600 });
  chmodSync(WALLET_PATH, 0o600);
  return file;
}

export async function loadAccount(): Promise<UnifiedAccount> {
  if (!existsSync(WALLET_PATH)) throw new Error(`no testnet wallet at ${WALLET_PATH}; run: npm run cli -- wallet:new`);
  const file = JSON.parse(readFileSync(WALLET_PATH, "utf8")) as WalletFile;
  if (file.network !== "testnet" || file.chainId !== TESTNET.chainId) throw new Error("wallet file is not a testnet wallet; refusing");
  const acc = await deriveUnifiedAccount(file.mnemonic);
  if (!file.address) {
    file.address = acc.cosmos;
    file.evm = acc.evm;
    writeFileSync(WALLET_PATH, JSON.stringify(file, null, 2), { mode: 0o600 });
  }
  return acc;
}

async function getJson(url: string): Promise<{ status: number; body: any }> {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

export async function accountInfo(address: string): Promise<{ exists: boolean; accountNumber: bigint; sequence: bigint }> {
  const { status, body } = await getJson(`${TESTNET.rest}/cosmos/auth/v1beta1/accounts/${address}`);
  if (status === 404 || !body.account) return { exists: false, accountNumber: 0n, sequence: 0n };
  const a = body.account.base_account ?? body.account;
  return { exists: true, accountNumber: BigInt(a.account_number ?? 0), sequence: BigInt(a.sequence ?? 0) };
}

export async function balances(address: string): Promise<{ denom: string; amount: string }[]> {
  const { body } = await getJson(`${TESTNET.rest}/cosmos/bank/v1beta1/balances/${address}`);
  return body.balances ?? [];
}

export async function pqStatus(address: string) {
  return fetchPqKeyStatus({ rest: TESTNET.rest, address });
}

function feeFor(gas: bigint) {
  const amount = BigInt(Math.ceil(Number(gas) * TESTNET.gasPriceUqor));
  return { amount: [{ denom: "uqor", amount: amount.toString() }], gas: gas.toString() };
}

/** Sign with a placeholder fee, simulate, then re-sign with the suggested gas limit. */
async function signSimulated(
  signer: EthNativeSigner,
  build: (fee: ReturnType<typeof feeFor>) => Uint8Array,
): Promise<{ txBytes: Uint8Array; gas: bigint }> {
  const draft = build(feeFor(2_000_000n));
  const exact = await hasExactSimulation({ rest: TESTNET.rest }).catch(() => false);
  const sim = await simulateTx({ rest: TESTNET.rest, txBytes: draft, exactSimulation: exact });
  const gas = sim.suggestedGasLimit;
  return { txBytes: build(feeFor(gas)), gas };
}

export async function waitCommitted(txhash: string, timeoutMs = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const tx = await inspectTransaction({ rest: TESTNET.rest, txhash, chainId: TESTNET.chainId }).catch(() => undefined);
    if (tx) return tx;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`tx ${txhash} not committed within ${timeoutMs / 1000}s`);
}

/** One-time MsgRegisterPQCKeyV2 (classical-only by design, with a proof of possession). */
export async function registerPqKey(acc: UnifiedAccount) {
  const status = await pqStatus(acc.cosmos);
  if (status.registered) {
    const same = status.publicKey && Buffer.from(status.publicKey).equals(Buffer.from(acc.pqc.publicKey));
    if (!same) throw new Error("a DIFFERENT ML-DSA-87 key is registered for this account; refusing");
    return { alreadyRegistered: true as const };
  }
  const info = await accountInfo(acc.cosmos);
  if (!info.exists) throw new Error("account not on chain yet: fund it from the testnet faucet first");
  const proofOfPossession = signProofOfPossession({ chainId: TESTNET.chainId, account: acc.cosmos, keypair: acc.pqc });
  const msg = buildRegisterPqcKeyMsg(acc.cosmos, {
    pqcKeypair: acc.pqc,
    ecdsaPubkey: fromHex(acc.publicKey.slice(2)),
    proofOfPossession,
  });
  const signer = new EthNativeSigner(acc, { signMode: "classical" });
  const { txBytes } = await signSimulated(signer, (fee) =>
    signer.sign({ chainId: TESTNET.chainId, accountNumber: info.accountNumber, sequence: info.sequence, messages: [msg], fee }).txRawBytes,
  );
  const res = await broadcastTx({ rest: TESTNET.rest, txBytes });
  if (res.code !== 0) throw new Error(`register refused: code ${res.code} ${res.codespace} ${res.log}`);
  const tx = await waitCommitted(res.txhash);
  return { alreadyRegistered: false as const, txhash: res.txhash, height: tx.height, code: tx.code };
}

/** Hybrid-signed (secp256k1 + ML-DSA-87) 1-uqor self-send whose memo is `qrg1:<fingerprint>`. */
export async function anchorFingerprint(acc: UnifiedAccount, fingerprint: string) {
  const info = await accountInfo(acc.cosmos);
  if (!info.exists) throw new Error("account not on chain yet: fund it from the testnet faucet first");
  const signer = new EthNativeSigner(acc, { signMode: "hybrid", rest: TESTNET.rest });
  const version = await signer.resolveSignBytesVersion(TESTNET.chainId);
  const messages = [
    {
      typeUrl: "/cosmos.bank.v1beta1.MsgSend",
      value: MsgSend.fromPartial({ fromAddress: acc.cosmos, toAddress: acc.cosmos, amount: [{ denom: "uqor", amount: "1" }] }),
    },
  ];
  const memo = anchorMemo(fingerprint);
  const { txBytes, gas } = await signSimulated(signer, (fee) =>
    signer.sign({ chainId: TESTNET.chainId, accountNumber: info.accountNumber, sequence: info.sequence, messages, fee, memo, signBytesVersion: version }).txRawBytes,
  );
  const res = await broadcastTx({ rest: TESTNET.rest, txBytes });
  if (res.code !== 0) throw new Error(`anchor refused: code ${res.code} ${res.codespace} ${res.log}`);
  const tx = await waitCommitted(res.txhash);
  return { txhash: res.txhash, height: tx.height, code: tx.code, gas, signBytesVersion: version };
}

/** Hybrid message signature, the same format QoreX `signArbitrary` returns. */
export function signReceiptMessage(acc: UnifiedAccount, chainId: string, message: string): MessageSignature {
  const classicalKey = classicalKeyFromPrivate(fromHex(acc.privateKey.slice(2)), "eth_secp256k1");
  return signMessage({ chainId, signer: acc.cosmos, data: message, classicalKey, pqKey: acc.pqc });
}
