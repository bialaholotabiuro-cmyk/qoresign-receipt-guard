import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// Offline checks of the CLI surface: nothing here touches the network or the wallet.
const run = (...args: string[]) =>
  spawnSync("npx", ["tsx", "scripts/cli.ts", ...args], { encoding: "utf8", timeout: 60_000 });

describe("cli send-proof", () => {
  it("refuses to run without a memo (nothing is signed or sent)", () => {
    const r = run("send-proof");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("usage: send-proof --memo");
  }, 60_000);

  it("is listed in the help text", () => {
    const r = run("help");
    expect(r.stdout).toContain("send-proof --memo");
  }, 60_000);
});
