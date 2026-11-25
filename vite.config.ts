import type { IncomingMessage, ServerResponse } from "node:http";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

import { toJson, verifyProofCard, type ProofCard } from "./src/lib/proof";

// The public REST API sends no CORS headers, so the browser reaches it through
// the dev (and preview) server: /lcd/* is forwarded to QORE_REST_PROXY_TARGET.
// POST /api/verify runs @qorechain/qoresign in Node, so proofs are verified
// server-side against the ML-DSA-87 key registered on chain.
function verifierApi(rest: string): Plugin {
  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.url !== "/api/verify" || req.method !== "POST") return next();
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const c of req) {
        size += (c as Buffer).length;
        if (size > 64 * 1024) throw new Error("proof card too large");
        chunks.push(c as Buffer);
      }
      const card = JSON.parse(Buffer.concat(chunks).toString("utf8")) as ProofCard;
      const report = await verifyProofCard(card, { rest, requireAnchor: false });
      res.setHeader("content-type", "application/json");
      res.end(toJson(report));
    } catch (e) {
      res.statusCode = 400;
      res.end(String((e as Error).message ?? e));
    }
  };
  return {
    name: "qrg-verifier-api",
    configureServer: (s) => void s.middlewares.use(handler),
    configurePreviewServer: (s) => void s.middlewares.use(handler),
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const target = env.QORE_REST_PROXY_TARGET || "http://localhost:1317";
  const proxy = {
    "/lcd": { target, changeOrigin: true, rewrite: (p: string) => p.replace(/^\/lcd/, "") },
  };
  return {
    plugins: [react(), verifierApi(target)],
    server: { port: 5173, proxy },
    preview: { proxy },
  };
});
