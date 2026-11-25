# AI usage

This project was built AI-native: an AI coding agent wrote most of the code, and a human set the direction, reviewed the work and handled every wallet step.

## Who did what

| Area | Human: Tomek Filipiak (Poland) | AI: Grok Bot (coding agent) |
| --- | --- | --- |
| Idea and scope | chose the problem (forgeable receipts) and approved the concept | proposed the Receipt Guard design and the proof-card format |
| Research | — | read the QoreChain docs (QoreX dApp integration, QoreSign, key binding, Workshop 1) and the `.d.ts` files of `@qorechain/sdk` / `@qorechain/qoresign` |
| Scaffold | — | ran `create-qorechain-dapp --template fullstack-web --network testnet` |
| Code | reviewed | wrote `src/lib/*`, `src/App.tsx`, `vite.config.ts` verifier API, `scripts/*` CLI |
| Tests | reviewed | wrote vitest unit, hybrid and live read-back tests and the mock-QoreX e2e |
| Wallet and keys | installs QoreX, claims the faucet, approves every signature and transaction | never sees a real key. Generated only a throwaway **testnet** key, stored in a file outside the repo |
| Demo video and submission | records the ≤3 min video, publishes the repo, registers | wrote DEMO_SCRIPT.md |

## How the AI was used

- **Docs-first.** The agent fetched `docs.qorechain.io/llms.txt` and the relevant pages, then read the type definitions shipped in `node_modules` instead of guessing APIs.
- **Verify, don't trust.** Every claim is backed by a test:
  - an anchor tx signed by `EthNativeSigner` (SDK) is independently verified by `verifyHybridTx` (QoreSign)
  - tampering, forged issuers, wrong ML-DSA keys and stripped PQ halves are all rejected
  - live tests read a real hybrid tx from the testnet
- **Small commits.** Each step (scaffold, model, CLI, tests, UI, docs) is a separate commit.

## Guardrails

- No private key, mnemonic or recovery code is in the repo or in any prompt. The testnet wallet file is git-ignored and lives outside the project folder.
- No mainnet. The code hard-codes `qorechain-diana` for signing paths and refuses non-testnet wallet files.
- The AI did not sign anything with the user's wallets, did not post, and did not publish. A human does those steps.
- ML-DSA-87 verification always uses the key registered on chain. This design choice came from the QoreX docs and is enforced in `src/lib/proof.ts`.

## Tools

- Grok Bot (AI agent with a Linux sandbox: Node 24, npm, git, headless Chrome)
- Node.js, TypeScript, Vite, React, vitest, tsx, puppeteer-core
