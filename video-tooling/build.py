#!/usr/bin/env python3
"""Assemble the demo video: piper TTS voice-over, scene cuts, burned-in subtitles, ffmpeg concat.
Inputs in ../../video/work (web.mp4 + web-marks.json, term.mp4 + term-marks.txt, card-*.png) and docs/cover.png.
Output: ../../video/qoresign-demo.mp4"""
import json, os, re, subprocess, wave, sys
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
VID = os.path.abspath(os.path.join(REPO, "..", "video")); W = os.path.join(VID, "work")
PIPER = os.environ.get("PIPER", "/opt/piper-venv/bin/piper")
VOICE = os.environ.get("PIPER_VOICE", "/workspace/tools/piper-voices/en_US-ryan-high.onnx")
LS = os.environ.get("LENGTH_SCALE", "0.95")
FPS = 30
# spoken forms for the TTS only; subtitles keep the real spelling
SAY = [("QoreSign", "Core Sign"), ("QoreChain", "Core Chain"), ("QoreX", "Core X"), ("qorechain", "core chain"),
       ("ML-DSA-87", "M L D S A 87"), ("ML-DSA", "M L D S A"), ("ECDSA", "E C D S A"), ("secp256k1", "sec P 256 K 1"),
       ("SHA-256", "Shaw 256"), ("fUSD", "F U S D"), ("REST API", "rest A P I"), ("SDK", "S D K"), ("pqc", "P Q C"),
       ("EthNativeSigner", "Eth Native Signer"), ("4,627", "4627"), ("2,500", "2500"), ("Q-Day", "Q Day"), ("MIT", "M I T")]
def say(t):
    for a, b in SAY: t = t.replace(a, b)
    return t
def sh(*a): subprocess.run(a, check=True)
def dur(p): return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]))

web = json.load(open(os.path.join(W, "web-marks.json")))
tm = {}; 
for line in open(os.path.join(W, "term-marks.txt")):
    k, v = line.split(); tm[k] = float(v)
term = {k: v - tm["rec-start"] for k, v in tm.items()}
def t_of(marks, expr):
    m = re.match(r"([\w-]+?)([+-][\d.]+)?$", expr); return max(0.0, marks[m.group(1)] + float(m.group(2) or 0))

scenes = json.load(open(os.path.join(HERE, "narration.json")))
LABEL = "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='WALLET MOCKED FOR RECORDING  (local SDK signer, real testnet tx)':x=w-tw-36:y=30:fontsize=26:fontcolor=white:box=1:boxcolor=0xb45309@0.92:boxborderw=14"
segs, t = [], 0.0
for i, s in enumerate(scenes):
    wav = os.path.join(W, f"vo-{s['id']}.wav")
    subprocess.run([PIPER, "-m", VOICE, "--length-scale", LS, "--sentence-silence", "0.25", "-f", wav], input=say(s["text"]).encode(), check=True, capture_output=True)
    a = dur(wav); D = a + 1.2
    out = os.path.join(W, f"seg-{i:02d}-{s['id']}.mp4")
    vf = []
    if s["src"].startswith(("web:", "term:")):
        kind, a0, a1 = s["src"].split(":"); marks = web if kind == "web" else term
        ss, to = t_of(marks, a0), t_of(marks, a1); foot = to - ss
        D = max(D, foot)
        vf.append(f"tpad=stop_mode=clone:stop_duration={D + 2:.3f}")
        if s.get("label"): vf.append(LABEL)
        vf.append(f"fps={FPS},format=yuv420p")
        sh("ffmpeg", "-y", "-loglevel", "error", "-ss", f"{ss:.3f}", "-t", f"{foot:.3f}", "-i", os.path.join(W, f"{kind}.mp4"), "-vf", ",".join(vf), "-t", f"{D:.3f}", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-r", str(FPS), out)
    else:
        img = os.path.join(REPO, "docs", "cover.png") if s["src"] == "cover" else os.path.join(W, s["src"] + ".png")
        sh("ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-i", img, "-vf", f"scale=1920:1080:flags=lanczos,fps={FPS},format=yuv420p,fade=in:st=0:d=0.4", "-t", f"{D:.3f}", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-tune", "stillimage", "-r", str(FPS), out)
    segs.append(dict(s, out=out, wav=wav, start=t, D=D, a=a)); t += D
total = t
print(f"total {total:.1f}s", [(s["id"], round(s["D"], 1)) for s in segs])
if total > 170: print("WARNING: longer than 2:50"); 

# voice-over track
with wave.open(segs[0]["wav"]) as w0: rate, sw, ch = w0.getframerate(), w0.getsampwidth(), w0.getnchannels()
vo = os.path.join(W, "voiceover.wav")
with wave.open(vo, "wb") as o:
    o.setnchannels(ch); o.setsampwidth(sw); o.setframerate(rate); written = 0
    for s in segs:
        target = int((s["start"] + 0.5) * rate)
        o.writeframes(b"\0" * (target - written) * sw * ch); written = target
        with wave.open(s["wav"]) as w: fr = w.readframes(w.getnframes()); o.writeframes(fr); written += w.getnframes()
    o.writeframes(b"\0" * max(0, int(total * rate) - written) * sw * ch)

# subtitles: sentences timed by character share of each scene's audio
def ts(x): h = int(x // 3600); m = int(x % 3600 // 60); return f"{h}:{m:02d}:{x % 60:05.2f}"
ass = ["[Script Info]", "ScriptType: v4.00+", "PlayResX: 1920", "PlayResY: 1080", "", "[V4+ Styles]",
       "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV",
       "Style: D,Noto Sans,42,&H00FFFFFF,&H00000000,&H99000000,0,3,12,0,2,160,160,48", "", "[Events]",
       "Format: Layer, Start, End, Style, Text"]
for s in segs:
    parts = [p for p in re.split(r"(?<=[.!?:])\s+", s["text"]) if p]
    n = sum(len(p) for p in parts); c = s["start"] + 0.5
    for p in parts:
        d = s["a"] * len(p) / n
        ass.append(f"Dialogue: 0,{ts(c)},{ts(c + d)},D,{p}"); c += d
open(os.path.join(W, "subs.ass"), "w").write("\n".join(ass) + "\n")
with open(os.path.join(W, "concat.txt"), "w") as f:
    for s in segs: f.write(f"file '{s['out']}'\n")
out = os.path.join(VID, "qoresign-demo.mp4")
sh("ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", os.path.join(W, "concat.txt"), "-i", vo,
   "-vf", f"subtitles={os.path.join(W, 'subs.ass')}", "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-pix_fmt", "yuv420p",
   "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-shortest", "-movflags", "+faststart", out)
print(out, f"{dur(out):.2f}s", os.path.getsize(out))
json.dump([{k: s[k] for k in ("id", "start", "D")} for s in segs], open(os.path.join(W, "timeline.json"), "w"), indent=1)
