# Demo video script (≤ 3:00)

Setup before recording:

- QoreX extension on **testnet (diana)**, funded from the faucet.
- `npm run dev` running, and a terminal in the repo.
- A second browser tab with explore.qore.network on Testnet.

| Time | Show | Say (short) |
| --- | --- | --- |
| 0:00–0:15 | Title screen / app header | "Receipts and invoices get forged. After Q-Day, ECDSA signatures can be forged too. QoreSign Receipt Guard signs every receipt with secp256k1 **and** ML-DSA-87 and anchors it on QoreChain." |
| 0:15–0:35 | Click **Connect QoreX** | "QoreX on the qorechain-diana testnet. The page never holds a key." |
| 0:35–1:00 | Fill the receipt (Invoice #2026-014, 250 fUSD), click **Sign with QoreX (hybrid)**, approve in QoreX | "The SHA-256 fingerprint of the canonical receipt is signed by QoreX: a classical ADR-36 signature plus a 4,627-byte ML-DSA-87 signature." |
| 1:00–1:30 | Click **Anchor fingerprint**, approve; the `shielded` pill appears | "Now a hybrid-signed transaction puts `qrg1:<fingerprint>` on chain. QoreX adds the post-quantum layer. The shield says the committed tx kept it." |
| 1:30–1:55 | Report: all PASS. Then the explorer tab: the tx is quantum-safe, ML-DSA-87 verified | "Our server-side verifier uses QoreSign. It checks the signature against the key registered on chain, reads the tx back, and confirms the memo, the signer and a verified ML-DSA-87 layer." |
| 1:55–2:25 | **Download proof card**. Edit `"amount": "250.00"` to `"2500.00"`, paste it into **Verify any proof card** → FAIL | "Anyone can verify a proof card. Change one character and the fingerprint, the signature and the anchor all fail." |
| 2:25–2:45 | Terminal: `npm test` (14 passing), `npm run cli -- verify proofs/<id>.json` | "Tests cover tampering, forged issuers, a wrong ML-DSA key and a stripped PQ half. A CLI does the same flow from Node with the SDK's hybrid EthNativeSigner." |
| 2:45–3:00 | README "Kits used" + repo | "Built with create-qorechain-dapp, the QoreChain SDK, QoreSign and QoreX. MIT, testnet only. #BuildBeforeQDay" |

Tips:

- Record at 1080p.
- Zoom the browser to 110%.
- Hide the bookmarks bar.
- Never show a seed phrase or the wallet file.
