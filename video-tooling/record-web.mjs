// Records the web app flow on a virtual display (DISPLAY, default :99) with ffmpeg x11grab.
// Wallet is MOCKED for the recording: window.qorex.native is replaced by a stub whose
// signArbitrary/signAndBroadcast are done by the local TESTNET wallet via the QoreChain SDK
// (hybrid secp256k1 + ML-DSA-87). The anchor tx is a real, committed testnet tx.
// Needs: npm run dev (http://localhost:5173), Xvfb on DISPLAY.
import puppeteer from "puppeteer-core";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = process.env.OUT_DIR ?? new URL("../../video/work", import.meta.url).pathname;
mkdirSync(OUT + "/dl", { recursive: true });
const DISPLAY = process.env.DISPLAY_REC ?? ":99";
const tsx = (file, ...args) => execFileSync("npx", ["tsx", new URL(file, import.meta.url).pathname, ...args], { cwd: ROOT, encoding: "utf8" });
const sign = (chainId, data) => JSON.parse(tsx("../e2e/signer.mts", chainId, Buffer.from(data).toString("base64")));
const { address } = sign("qorechain-diana", "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
  headless: false, defaultViewport: null,
  env: { ...process.env, DISPLAY },
  args: ["--no-sandbox", "--kiosk", "--window-position=0,0", "--window-size=1280,720", "--force-device-scale-factor=1.5", "--no-first-run", "--disable-infobars", "--hide-scrollbars"],
});
const [page] = await browser.pages();
await page.exposeFunction("__qrgSign", (chainId, signer, data) => sign(chainId, data).sig);
await page.exposeFunction("__qrgAnchor", (memo) => JSON.parse(tsx("./anchor.mts", memo)));
await page.evaluateOnNewDocument((address) => {
  window.qorex = { native: {
    capabilities: ["signAndBroadcast", "signArbitrary"],
    enable: async () => {},
    getKey: async () => ({ bech32Address: address }),
    signArbitrary: (c, s, d) => window.__qrgSign(c, s, d),
    signAndBroadcast: (req) => window.__qrgAnchor(req.memo),
  } };
}, address);
const cdp = await page.createCDPSession();
await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: OUT + "/dl" });
await page.goto("http://localhost:5173/", { waitUntil: "networkidle0" });
await sleep(1500);

const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "x11grab", "-draw_mouse", "0", "-framerate", "30", "-video_size", "1920x1080", "-i", DISPLAY, "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", OUT + "/web.mp4"], { stdio: ["pipe", "inherit", "inherit"] });
const t0 = Date.now();
const marks = {};
const mark = (k) => { marks[k] = (Date.now() - t0) / 1000; console.log("mark", k, marks[k]); };
const btn = async (text) => (await page.$$(`xpath/.//button[contains(., "${text}")]`))[0];
const scrollTo = async (sel, block = "start") => { await page.evaluate((s, b) => document.querySelector(s)?.scrollIntoView({ behavior: "smooth", block: b }), sel, block); await sleep(1200); };
const scrollToText = async (text, block = "center") => { await page.evaluate((t, b) => { const el = [...document.querySelectorAll("h2,button,p")].find((e) => e.innerText.includes(t)); el?.scrollIntoView({ behavior: "smooth", block: b }); }, text, block); await sleep(1200); };
const typeInto = async (label, value) => {
  const input = (await page.$$(`xpath/.//label[contains(., "${label}")]//input`))[0];
  await input.click({ clickCount: 3 }); await page.keyboard.press("Backspace");
  await input.type(value, { delay: 45 });
};

await sleep(2500); mark("start");
await (await btn("Connect QoreX")).click();
await page.waitForFunction(() => document.body.innerText.includes("Connected:"));
mark("connected"); await sleep(3000);
await typeInto("Title", "Invoice #2026-014 - logo design");
await typeInto("Amount", "250.00");
await typeInto("Currency", "fUSD");
await typeInto("Note", "paid by bank transfer");
mark("filled"); await sleep(1500);
await (await btn("Sign with QoreX")).click();
await page.waitForFunction(() => document.body.innerText.includes("ml-dsa-87-hybrid"), { timeout: 60000 });
mark("signed"); await scrollToText("3 · Anchor", "start"); await sleep(3500);
await (await btn("Anchor fingerprint")).click();
await page.waitForFunction(() => document.body.innerText.includes("Anchor tx"), { timeout: 120000 });
mark("anchored"); await sleep(2500);
await page.waitForSelector(".report", { timeout: 60000 });
mark("report"); await scrollTo(".report", "start"); await sleep(6000);
const txhash = await page.evaluate(() => (document.body.innerText.match(/Anchor tx ([0-9A-F]{64})/) || [])[1]);
// download the card, tamper with one field, verify it
await scrollToText("3 · Anchor", "start");
await (await btn("Download proof card")).click(); await sleep(1500);
mark("downloaded");
const file = readdirSync(OUT + "/dl").filter((f) => f.endsWith(".json")).map((f) => OUT + "/dl/" + f)[0];
const card = JSON.parse(readFileSync(file, "utf8"));
writeFileSync(OUT + "/web-card.json", JSON.stringify(card, null, 2));
const tampered = JSON.stringify({ ...card, receipt: { ...card.receipt, amount: "2500.00" } }, null, 2);
await scrollToText("4 · Verify any", "start");
await page.evaluate((v) => {
  const ta = document.querySelector("textarea");
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(ta, v);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  const i = v.indexOf('"amount"'); ta.focus(); ta.setSelectionRange(i, i + 21);
  const lines = v.slice(0, i).split("\n").length; ta.scrollTop = Math.max(0, (lines - 2) * 22);
}, tampered);
mark("pasted"); await sleep(4000);
await (await btn("Verify against the chain")).click();
await page.waitForFunction(() => /FAILED|FAIL/.test(document.querySelector(".report")?.innerText ?? ""), { timeout: 60000 });
mark("tamper-report"); await scrollTo(".report", "start"); await sleep(7000);
mark("end");
ff.stdin.write("q"); await new Promise((r) => ff.on("close", r));
writeFileSync(OUT + "/web-marks.json", JSON.stringify({ ...marks, txhash }, null, 2));
await browser.close();
console.log("txhash", txhash);
