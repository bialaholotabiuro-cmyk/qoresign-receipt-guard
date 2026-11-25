/**
 * Thin QoreX (window.qorex.native) wrapper. The page never holds a private key:
 * QoreX makes both halves of every signature (secp256k1 + ML-DSA-87).
 * Docs: https://docs.qorechain.io/qorex/dapp-integration
 */
import type { MessageSignature } from "@qorechain/qoresign";
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx";

import { anchorMemo } from "./receipt";

interface QorexNative {
  capabilities?: string[];
  enable(chainId: string): Promise<void>;
  getKey(chainId: string): Promise<{ bech32Address: string; name?: string; algo?: string }>;
  signArbitrary(chainId: string, signer: string, data: string): Promise<MessageSignature>;
  signAndBroadcast(req: {
    chainId: string;
    messages: { typeUrl: string; value: Uint8Array | number[] | string }[];
    memo?: string;
    gasLimit?: number;
  }): Promise<{ txHash: string; code: number; height?: number; shield?: string; rawLog?: string }>;
}

declare global {
  interface Window {
    qorex?: { native?: QorexNative };
  }
}

export function qorex(): QorexNative {
  const n = window.qorex?.native;
  if (!n) throw new Error("QoreX not found. Install the QoreX extension, turn on Developer mode and switch to testnet (diana).");
  return n;
}

export function hasCapability(cap: string): boolean {
  const n = window.qorex?.native;
  if (!n) return false;
  if (n.capabilities) return n.capabilities.includes(cap);
  return typeof (n as unknown as Record<string, unknown>)[cap] === "function";
}

export async function connect(chainId: string): Promise<string> {
  const n = qorex();
  await n.enable(chainId);
  const key = await n.getKey(chainId);
  return key.bech32Address;
}

export async function signReceipt(chainId: string, signer: string, message: string): Promise<MessageSignature> {
  if (!hasCapability("signArbitrary")) throw new Error("This QoreX build has no signArbitrary; please update QoreX.");
  return qorex().signArbitrary(chainId, signer, message);
}

/** 1 uqor self-send carrying `qrg1:<fingerprint>`; QoreX adds the ML-DSA-87 layer and broadcasts. */
export async function anchorReceipt(chainId: string, signer: string, fingerprint: string) {
  if (!hasCapability("signAndBroadcast")) throw new Error("This QoreX build has no signAndBroadcast; please update QoreX.");
  const value = MsgSend.encode(
    MsgSend.fromPartial({ fromAddress: signer, toAddress: signer, amount: [{ denom: "uqor", amount: "1" }] }),
  ).finish();
  return qorex().signAndBroadcast({
    chainId,
    messages: [{ typeUrl: "/cosmos.bank.v1beta1.MsgSend", value }],
    memo: anchorMemo(fingerprint),
    gasLimit: 400_000,
  });
}
