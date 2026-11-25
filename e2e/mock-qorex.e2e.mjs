// Headless smoke test of the web UI with a MOCK QoreX provider backed by the local testnet wallet.
// The mock "anchor" returns a public hybrid tx that is not ours, so the memo/signer checks are expected to FAIL.
// Run: npm run dev (in another shell), then npm run e2e
import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";
const ROOT = new URL("..", import.meta.url).pathname;
const sign = (chainId, data) => JSON.parse(execFileSync("npx", ["tsx", new URL("./signer.mts", import.meta.url).pathname, chainId, Buffer.from(data).toString("base64")], { cwd: ROOT, encoding: "utf8" }));
const { address } = sign("qorechain-diana", "");
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
page.on("console", (m) => console.log("console:", m.text()));
await page.exposeFunction("__qrgSign", (chainId, signer, data) => sign(chainId, data).sig);
await page.evaluateOnNewDocument((address) => {
  window.qorex = { native: {
    capabilities: ["signAndBroadcast", "signArbitrary"],
    enable: async () => {},
    getKey: async () => ({ bech32Address: address }),
    signArbitrary: (c, s, d) => window.__qrgSign(c, s, d),
    signAndBroadcast: async (req) => { window.__lastReq = { memo: req.memo, n: req.messages.length, type: req.messages[0].typeUrl }; return { txHash: "75C5B0368ED4AA6A12BDE670810BEFCC1380079A5BC61252806C806CB8E3E9A5", code: 0, height: 10756167, shield: "shielded" }; },
  } };
}, address);
await page.goto("http://localhost:5173/", { waitUntil: "networkidle0" });
await page.screenshot({ path: "e2e/1-start.png" });
const click = async (text) => { const [b] = await page.$$(`xpath/.//button[contains(., "${text}")]`); await b.click(); };
await click("Connect QoreX");
await page.waitForFunction(() => document.body.innerText.includes("Connected:"));
await click("Sign with QoreX");
await page.waitForFunction(() => document.body.innerText.includes("ml-dsa-87-hybrid"), { timeout: 30000 });
await page.screenshot({ path: "e2e/2-signed.png", fullPage: true });
await click("Anchor fingerprint");
await page.waitForSelector(".report", { timeout: 40000 });
console.log("lastReq", JSON.stringify(await page.evaluate(() => window.__lastReq)));
console.log(await page.$eval(".report", (e) => e.innerText));
await page.screenshot({ path: "e2e/3-report.png", fullPage: true });
await browser.close();
