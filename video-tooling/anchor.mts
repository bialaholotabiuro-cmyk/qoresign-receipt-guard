// Recording helper: stands in for QoreX's signAndBroadcast in the mocked-wallet recording.
// It signs the SAME request (1 uqor self-send + memo) with the local TESTNET wallet using the
// SDK's hybrid EthNativeSigner (secp256k1 + ML-DSA-87) and really broadcasts it to qorechain-diana.
// The "shield" value is derived from the committed tx (tier pqc => "shielded"), not invented.
import { inspectTransaction } from "@qorechain/qoresign/network";
import { loadAccount, sendSelfMemo, TESTNET } from "../scripts/chain";

const memo = process.argv[2];
if (!memo?.startsWith("qrg1:")) throw new Error("expected a qrg1:<fingerprint> memo");
const acc = await loadAccount();
const r = await sendSelfMemo(acc, memo);
const tx = await inspectTransaction({ rest: TESTNET.rest, txhash: r.txhash, chainId: TESTNET.chainId });
process.stdout.write(JSON.stringify({ txHash: r.txhash, code: r.code, height: Number(r.height), shield: tx?.tier === "pqc" && tx.pqLayer.verified ? "shielded" : "unshielded" }));
