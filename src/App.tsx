import { useEffect, useMemo, useState } from "react";

import { createClient } from "@qorechain/sdk";

import { buildProofCard, toJson, type ProofCard, type VerifyReport } from "./lib/proof";
import { anchorReceipt, connect, signReceipt } from "./lib/qorex";
import {
  addressForms,
  createReceipt,
  DEFAULT_CHAIN_ID,
  receiptFingerprint,
  signingMessage,
  type Receipt,
  type ReceiptInput,
} from "./lib/receipt";
import "./styles.css";

const REST_URL = import.meta.env.VITE_QORE_REST_URL ?? "/lcd";
const CHAIN_ID = DEFAULT_CHAIN_ID;
const EXPLORER = "https://explore.qore.network";

type Step = "connect" | "draft" | "signed" | "anchored";

async function verifyOnServer(card: ProofCard): Promise<VerifyReport> {
  const res = await fetch("/api/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(card) });
  if (!res.ok) throw new Error(`verifier HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

function Report({ report }: { report: VerifyReport }) {
  return (
    <div className={`report ${report.ok ? "ok" : "bad"}`}>
      <strong>{report.ok ? "Authentic and untampered" : "Verification failed"}</strong>
      <ul>
        {report.checks.map((c) => (
          <li key={c.id} className={c.status}>
            <span className="tag">{c.status.toUpperCase()}</span> {c.label}
            {c.detail && <div className="detail">{c.detail}</div>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function App(): JSX.Element {
  const client = useMemo(() => createClient({ network: "testnet", endpoints: { rest: REST_URL } }), []);
  const [account, setAccount] = useState<string>("");
  const [balance, setBalance] = useState<string>("");
  const [input, setInput] = useState<ReceiptInput>({ title: "Invoice #2026-014 - logo design", amount: "250.00", currency: "fUSD", counterparty: "", note: "" });
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [card, setCard] = useState<ProofCard | null>(null);
  const [shield, setShield] = useState<string>("");
  const [report, setReport] = useState<VerifyReport | null>(null);
  const [pasted, setPasted] = useState("");
  const [addr, setAddr] = useState("");
  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState<string>("");

  const step: Step = !account ? "connect" : !card ? "draft" : card.anchor ? "anchored" : "signed";
  const preview = useMemo(() => {
    if (!account) return null;
    try {
      return createReceipt(input, { issuer: account, chainId: CHAIN_ID, now: new Date(0), nonce: "0".repeat(32) });
    } catch {
      return null;
    }
  }, [account, input]);

  useEffect(() => {
    if (!account) return;
    client.rest
      .getAllBalances(account)
      .then((r) => {
        const q = (r.balances as { denom: string; amount: string }[]).find((b) => b.denom === "uqor");
        setBalance(q ? `${(Number(q.amount) / 1e6).toFixed(3)} QOR` : "0 QOR");
      })
      .catch(() => setBalance("?"));
  }, [account, client, card]);

  async function run(label: string, fn: () => Promise<void>) {
    setError("");
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      const err = e as { code?: string | number; message?: string };
      setError(`${err.code ? `[${err.code}] ` : ""}${err.message ?? String(e)}`);
    } finally {
      setBusy("");
    }
  }

  const onConnect = () => run("Connecting QoreX…", async () => setAccount(await connect(CHAIN_ID)));

  const onSign = () =>
    run("Waiting for QoreX signature…", async () => {
      const r = createReceipt(input, { issuer: account, chainId: CHAIN_ID });
      const sig = await signReceipt(CHAIN_ID, account, signingMessage(r));
      setReceipt(r);
      setCard(buildProofCard({ receipt: r, signature: sig }));
      setReport(null);
    });

  const onAnchor = () =>
    run("Anchoring on QoreChain testnet…", async () => {
      if (!receipt || !card) return;
      const res = await anchorReceipt(CHAIN_ID, account, card.receiptSha256);
      if (res.code !== 0) throw new Error(`anchor tx failed: code ${res.code} ${res.rawLog ?? ""}`);
      setShield(res.shield ?? "");
      const anchored = { ...card, anchor: { txhash: res.txHash, height: res.height?.toString(), chainId: CHAIN_ID } };
      setCard(anchored);
      // give the REST gateway a moment to index the tx, then verify server-side
      await new Promise((r) => setTimeout(r, 6000));
      setReport(await verifyOnServer(anchored));
    });

  const onVerifyPasted = () =>
    run("Verifying…", async () => {
      setReport(await verifyOnServer(JSON.parse(pasted) as ProofCard));
    });

  const forms = (() => {
    try {
      return addr.trim() ? addressForms(addr) : null;
    } catch {
      return "invalid";
    }
  })();

  return (
    <main>
      <header>
        <h1>QoreSign Receipt Guard</h1>
        <p className="sub">
          Tamper-evident receipts, signed with <b>secp256k1 + ML-DSA-87</b> in QoreX and anchored on QoreChain.
          Network <code>{client.network.name}</code> · <code>{CHAIN_ID}</code>
        </p>
        <ol className="steps">
          {(["connect", "draft", "signed", "anchored"] as Step[]).map((s, i) => (
            <li key={s} className={s === step ? "active" : ""}>
              {i + 1}. {{ connect: "Connect QoreX", draft: "Write & sign", signed: "Anchor on chain", anchored: "Share proof" }[s]}
            </li>
          ))}
        </ol>
      </header>

      <section className="card">
        <h2>1 · Wallet</h2>
        {account ? (
          <p>
            Connected: <code>{account}</code> <span className="muted">({addressForms(account).hex})</span> · {balance}
          </p>
        ) : (
          <>
            <button onClick={onConnect} disabled={!!busy}>Connect QoreX (testnet)</button>
            <p className="muted">QoreX extension → Developer mode → Switch to testnet (diana). Fund the account at dashboard.qorechain.io/faucet.</p>
          </>
        )}
      </section>

      <section className="card">
        <h2>2 · Receipt</h2>
        <div className="grid">
          <label>Title<input value={input.title} onChange={(e) => setInput({ ...input, title: e.target.value })} /></label>
          <label>Amount<input value={input.amount} onChange={(e) => setInput({ ...input, amount: e.target.value })} /></label>
          <label>Currency<input value={input.currency} onChange={(e) => setInput({ ...input, currency: e.target.value })} /></label>
          <label>Counterparty (qor1… optional)<input value={input.counterparty} onChange={(e) => setInput({ ...input, counterparty: e.target.value })} /></label>
          <label className="wide">Note<input value={input.note} onChange={(e) => setInput({ ...input, note: e.target.value })} /></label>
        </div>
        {preview && <p className="muted">Fingerprint preview (final one adds time + nonce): <code>{receiptFingerprint(preview).slice(0, 24)}…</code></p>}
        <button onClick={onSign} disabled={!account || !!busy}>Sign with QoreX (hybrid)</button>
      </section>

      {card && (
        <section className="card">
          <h2>3 · Anchor & proof</h2>
          <p>
            SHA-256 <code>{card.receiptSha256}</code>
            <br />
            Signature: <b>{card.signature.signatureType}</b>
            {card.signature.pq && <> · ML-DSA-87 {atob(card.signature.pq.signature).length} bytes</>}
          </p>
          {!card.anchor ? (
            <button onClick={onAnchor} disabled={!!busy}>Anchor fingerprint on QoreChain (hybrid-signed tx)</button>
          ) : (
            <p>
              Anchor tx <code>{card.anchor.txhash}</code> {shield && <span className={`pill ${shield}`}>{shield}</span>}
              <br />
              <a href={EXPLORER} target="_blank" rel="noreferrer">Open explorer (switch to Testnet, search the hash)</a>
            </p>
          )}
          <div className="row">
            <button onClick={() => download(`receipt-proof-${card.receiptSha256.slice(0, 12)}.json`, toJson(card))}>Download proof card</button>
            <button onClick={() => run("Verifying…", async () => setReport(await verifyOnServer(card)))} disabled={!!busy}>Verify now</button>
          </div>
        </section>
      )}

      <section className="card">
        <h2>4 · Verify any proof card</h2>
        <textarea rows={6} placeholder="Paste a receipt-proof JSON…" value={pasted} onChange={(e) => setPasted(e.target.value)} />
        <button onClick={onVerifyPasted} disabled={!pasted || !!busy}>Verify against the chain</button>
        <p className="muted">Verification runs on the server (Vite middleware, @qorechain/qoresign): the ML-DSA-87 half is checked against the key registered on chain, never one sent by the page.</p>
      </section>

      {report && <Report report={report} />}

      <section className="card">
        <h2>Address helper</h2>
        <input placeholder="qor1… or 0x…" value={addr} onChange={(e) => setAddr(e.target.value)} />
        {forms === "invalid" && <p className="err">Not a QoreChain address.</p>}
        {forms && forms !== "invalid" && (
          <p>
            <code>{forms.qor}</code> ⇄ <code>{forms.hex}</code> <span className="muted">(same 20 bytes)</span>
          </p>
        )}
      </section>

      {busy && <div className="busy">{busy}</div>}
      {error && <p className="err" role="alert">{error}</p>}
      <footer className="muted">Testnet only. No value. MIT licensed. Built for #BuildBeforeQDay.</footer>
    </main>
  );
}
