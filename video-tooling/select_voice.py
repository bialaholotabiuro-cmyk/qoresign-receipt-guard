#!/usr/bin/env python3
"""Re-synthesise narration clips and keep the take whose Whisper transcript best matches the text.
Accepted wavs go in ../../video/work/accepted-vo/. build.py prefers those over a fresh piper run."""
from __future__ import annotations
import hashlib, json, os, re, shutil, subprocess, wave
from pathlib import Path

import numpy as np
from faster_whisper import WhisperModel

HERE = Path(__file__).resolve().parent
W = (HERE / ".." / ".." / "video" / "work").resolve()
ACCEPT = W / "accepted-vo"
PIPER = os.environ.get("PIPER", "/opt/piper-venv/bin/piper")
VOICES = {
    "ryan": os.environ.get("PIPER_VOICE", "/workspace/tools/piper-voices/en_US-ryan-high.onnx"),
    "lessac": "/workspace/tools/piper-voices/en_US-lessac-medium.onnx",
}
RATE = 22050
THRESHOLD = 0.10
TAKES = int(os.environ.get("VO_TAKES", "6"))

# Spoken forms: TTS input only. Subtitles always use narration.json spelling.
SAY = [
    ("QoreSign", "Core Sign"), ("QoreChain", "Core Chain"), ("QoreX", "Core X"),
    ("qorechain", "core chain"),
    ("ML-DSA-87", "M L D S A 87"), ("ML-DSA", "M L D S A"),
    ("ECDSA", "E C D S A"), ("secp256k1", "sec P 256 K 1"),
    ("SHA-256", "S H A 256"), ("fUSD", "F U S D"),
    ("REST API", "rest API"), ("SDK", "S D K"),
    ("pqc_hybrid_verify", "P Q C hybrid verify"),
    ("EthNativeSigner", "eth native signer"),
    ("4,627", "4627"), ("2,500", "2500"),
    ("Q-Day", "Q Day"), ("MIT", "M I T"),
    ("create-qorechain-dapp", "create core chain dapp"),
    ("testnet", "test net"), ("hybrid-signed", "hybrid signed"),
]
def say(t: str) -> str:
    for a, b in SAY:
        t = t.replace(a, b)
    return t

# Alternative spoken forms tried when a take misses the target WER.
ALT = [
    ("M L D S A 87", "M L D S A eighty seven"),
    ("M L D S A", "M L D S A"),
    ("sec P 256 K 1", "seck P 256 K 1"),
    ("S H A 256", "Shaw 256"),
    ("rest API", "rest A P I"),
    ("eth native signer", "E V M native signer"),
    ("create core chain dapp", "create core chain dap"),
    ("Core Sign", "Kor Sign"),
    ("test net", "testnet"),
]
def spoken_variants(display: str) -> list[str]:
    base = say(display)
    out = [base]
    for a, b in ALT:
        if a in base:
            out.append(base.replace(a, b))
    # unique, stable
    seen, uniq = set(), []
    for s in out:
        if s not in seen:
            seen.add(s); uniq.append(s)
    return uniq

CANON = [
    (r"\bsixteen\b", "16"), (r"\bseven\b", "7"), (r"\beighty\s*seven\b", "87"),
    (r"\baccount\s+s\b", "account"),  # "account's" after punctuation strip
    (r"\baccounts\b", "account"),
    (r"\bcourt\s*chain\b", "qorechain"),
    (r"\b(?:courseign|horsesign|course\s*sign)\b", "qoresign"),
    (r"\bm\s*l\s*d\s*s\s*a\s*87\b", "mldsa87"),
    (r"\bml[\s-]*d[\s-]*s[\s-]*a[\s-]*87\b", "mldsa87"),
    (r"\bml[\s-]*dsa[\s-]*87\b", "mldsa87"),
    (r"\bmld[\s-]*s[\s-]*87\b", "mldsa87"),
    (r"\bmld\s*s[\s-]*a\s*87\b", "mldsa87"),
    (r"\bmld\s*,\s*sa\s*87\b", "mldsa87"),
    (r"\bnld\s*s\s*87\b", "mldsa87"),
    (r"\bmldsa[\s-]*87\b", "mldsa87"),
    (r"\bnml\s*dsa\s*87\b", "mldsa87"),
    (r"\bm\s*l\s*d\s*s\s*a\b", "mldsa"),
    (r"\bml[\s-]*dsa\b", "mldsa"),
    (r"\bsec(?:k)?\s*p\s*256\s*k\s*1\b", "secp256k1"),
    (r"\bsecp\s*256\s*k1\b", "secp256k1"),
    (r"\bs\s*h\s*a\s*256\b", "sha256"),
    (r"\bshaw\s*256\b", "sha256"),
    (r"\bsh\s*256\b", "sha256"),
    (r"\bsha[\s-]*256\b", "sha256"),
    (r"\be\s*c\s*d\s*s\s*a\b", "ecdsa"),
    (r"\becds\b", "ecdsa"),
    (r"\b(?:core|kor|course)\s*sign\b", "qoresign"),
    (r"\bcore\s*chain\b", "qorechain"),
    (r"\bcore\s*x\b", "qorex"),
    (r"\bqore\s*sign\b", "qoresign"),
    (r"\bqore\s*chain\b", "qorechain"),
    (r"\bqore\s*x\b", "qorex"),
    (r"\bf\s*u\s*s\s*d\b", "fusd"),
    (r"\bs\s*d\s*k\b", "sdk"),
    (r"\bp\s*q\s*c\b", "pqc"),
    (r"\brest\s*(?:of\s*)?a\s*p\s*i\b", "restapi"),
    (r"\brest\s*api\b", "restapi"),
    (r"\beth\s*native\s*signer\b", "ethnativesigner"),
    (r"\be\s*v\s*m\s*native\s*signer\b", "ethnativesigner"),
    (r"\bearth\s*native\s*s[iy]gn(?:er)?\b", "ethnativesigner"),
    (r"\bm\s*i\s*t\b", "mit"),
    (r"\bq[\s-]*day\b", "qday"),
    (r"\b2[\s,]*500\b", "2500"),
    (r"\b4[\s,]*627\b", "4627"),
    (r"\btest\s*net\b", "testnet"),
    (r"\btess\s*net\b", "testnet"),
    (r"\btest\s*it\b", "testnet"),  # common piper/whisper confusion of "testnet"
    (r"\bhybrid[\s-]*signed\b", "hybridsigned"),
    (r"\bhybrid\s*sign\b", "hybridsigned"),
    (r"\b(?:dap|dapp|depth|deft)\b", "dapp"),
    (r"\b4[\s,]*627\s*by\b", "4627 byte"),
]
def tokens(text: str) -> list[str]:
    t = " " + re.sub(r"[^a-z0-9]+", " ", text.lower()) + " "
    for pat, rep in CANON:
        t = re.sub(pat, " " + rep + " ", t)
    return re.sub(r"\s+", " ", t).strip().split()

def wer(ref: str, hyp: str) -> tuple[float, int, int]:
    r, h = tokens(ref), tokens(hyp)
    if not r:
        return (0.0 if not h else 1.0), len(h), 0
    n, m = len(r), len(h)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        dp[i][0] = i
    for j in range(m + 1):
        dp[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            dp[i][j] = dp[i - 1][j - 1] if r[i - 1] == h[j - 1] else 1 + min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    return dp[n][m] / n, dp[n][m], n

def load_wav(path: Path) -> np.ndarray:
    with wave.open(str(path)) as w:
        assert w.getframerate() == RATE and w.getnchannels() == 1 and w.getsampwidth() == 2
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768

def load16(path: Path) -> np.ndarray:
    x = load_wav(path)
    n = int(round(len(x) * 16000 / RATE))
    t = np.linspace(0, 1, len(x), endpoint=False)
    t2 = np.linspace(0, 1, n, endpoint=False)
    return np.interp(t2, t, x).astype(np.float32)

def transcribe(model: WhisperModel, path: Path) -> str:
    segs, _ = model.transcribe(load16(path), language="en")
    return " ".join(s.text for s in segs).strip()

PARAMS = [
    # length, noise_scale, noise_w, voice
    (0.95, 0.5, 0.6, "ryan"),      # requested
    (1.00, 0.5, 0.6, "ryan"),
    (1.05, 0.5, 0.6, "ryan"),
    (0.95, 0.667, 0.8, "ryan"),    # model defaults, slightly slower than prior 0.88
    (1.00, 0.4, 0.5, "ryan"),
    (0.95, 0.5, 0.6, "lessac"),
]

def piper(text: str, dest: Path, length: float, noise: float, noise_w: float, voice: str) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".tmp.wav")
    subprocess.run(
        [PIPER, "-m", VOICES[voice], "--no-normalize",
         "--length-scale", str(length), "--noise-scale", str(noise), "--noise-w", str(noise_w),
         "--sentence-silence", "0.35", "-f", str(tmp)],
        input=(text.strip() + "\n").encode(), check=True, capture_output=True,
    )
    x = load_wav(tmp)
    # trim trailing silence but keep ~200 ms so the last word is not cut off
    env = np.abs(x)
    win = int(0.02 * RATE)
    if win > 0:
        ker = np.ones(win) / win
        sm = np.convolve(env, ker, mode="same")
        nz = np.where(sm > 0.01)[0]
        if len(nz):
            end = min(len(x), nz[-1] + int(0.20 * RATE))
            start = max(0, nz[0] - int(0.04 * RATE))
            x = x[start:end]
    n = int(0.012 * RATE)
    if len(x) > 2 * n:
        x[:n] *= np.linspace(0, 1, n)
        x[-n:] *= np.linspace(1, 0, n)
    with wave.open(str(dest), "wb") as o:
        o.setnchannels(1); o.setsampwidth(2); o.setframerate(RATE)
        o.writeframes((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes())
    tmp.unlink(missing_ok=True)

def display_of(sent) -> str:
    return sent["text"] if isinstance(sent, dict) else sent

def main() -> None:
    scenes = json.loads((HERE / "narration.json").read_text())
    ACCEPT.mkdir(parents=True, exist_ok=True)
    model = WhisperModel("base", device="cpu", compute_type="int8")
    report = []
    for sc in scenes:
        for j, sent in enumerate(sc["sentences"]):
            display = display_of(sent)
            key = f"{sc['id']}-{j}"
            dest = ACCEPT / f"vo-{key}.wav"
            existing = W / f"vo-{key}.wav"
            candidates: list[tuple[float, int, int, str, Path, str, str]] = []

            def consider(path: Path, tag: str):
                if not path.exists():
                    return
                hyp = transcribe(model, path)
                w, ed, n = wer(display, hyp)
                candidates.append((w, ed, n, tag, path, hyp, display))
                print(f"  {key:10} {tag:28} WER={w*100:5.1f}%  hyp={hyp!r}")

            # score any current clip first
            if existing.exists():
                consider(existing, "current")
            if dest.exists():
                consider(dest, "accepted-prev")

            best = min(candidates, key=lambda c: c[0]) if candidates else None
            if best and best[0] <= THRESHOLD:
                if best[4] != dest:
                    shutil.copy2(best[4], dest)
                print(f"KEEP {key} WER={best[0]*100:.1f}% ({best[3]})")
                report.append({"id": key, "wer": best[0], "edits": best[1], "n": best[2], "text": display, "hyp": best[5], "take": best[3], "kept": True})
                continue

            # generate new takes
            variants = spoken_variants(display)
            trial = 0
            for length, noise, noise_w, voice in PARAMS:
                for spoken in variants[:2]:  # default + first alt
                    for _ in range(TAKES if trial == 0 else 2):
                        trial += 1
                        p = W / "takes" / f"{key}-t{trial}.wav"
                        try:
                            piper(spoken, p, length, noise, noise_w, voice)
                        except Exception as e:
                            print("piper fail", e)
                            continue
                        tag = f"{voice}/l{length}/n{noise}/w{noise_w}/#{trial}"
                        consider(p, tag)
                        if candidates and min(candidates)[0] == 0.0:
                            break
                    if candidates and min(c[0] for c in candidates) == 0.0:
                        break
                if candidates and min(c[0] for c in candidates) <= THRESHOLD:
                    break

            if not candidates:
                raise SystemExit(f"no takes for {key}")
            best = min(candidates, key=lambda c: (c[0], c[1]))
            shutil.copy2(best[4], dest)
            ok = best[0] <= THRESHOLD
            print(f"{'OK  ' if ok else 'BEST'} {key} WER={best[0]*100:.1f}% take={best[3]} hyp={best[5]!r}")
            report.append({"id": key, "wer": best[0], "edits": best[1], "n": best[2], "text": display, "hyp": best[5], "take": best[3], "kept": ok})

    (W / "wer-report.json").write_text(json.dumps(report, indent=2))
    print("\n=== WER report ===")
    for r in report:
        flag = "ok  " if r["wer"] <= THRESHOLD else "HIGH"
        print(f"{flag} {r['id']:10} {r['wer']*100:5.1f}%  {r['take']}  | {r['hyp']}")
    high = [r for r in report if r["wer"] > THRESHOLD]
    if high:
        print(f"WARNING: {len(high)} clip(s) still above {THRESHOLD*100:.0f}% WER")

if __name__ == "__main__":
    main()
