#!/usr/bin/env python3
"""Assemble the demo video: piper TTS voice-over (per sentence, unnormalised), loudness-normalised mix,
scene cuts, step-by-step reveal cards with slow zoom, burned-in subtitles (display spelling), ffmpeg concat.
Inputs in ../../video/work (web.mp4 + web-marks.json, term.mp4 + term-marks.txt, card PNGs) and docs/cover.png.
Output: ../../video/qoresign-demo.mp4"""
import json, os, re, subprocess, sys, wave
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); REPO = os.path.dirname(HERE)
VID = os.path.abspath(os.path.join(REPO, "..", "video")); W = os.path.join(VID, "work")
PIPER = os.environ.get("PIPER", "/opt/piper-venv/bin/piper")
VOICE = os.environ.get("PIPER_VOICE", "/workspace/tools/piper-voices/en_US-ryan-high.onnx")
LS = os.environ.get("LENGTH_SCALE", "1.0")
FPS = 30; GAP = 0.35; LEAD = 0.5; TAIL = 1.0
# Spoken forms: used ONLY as TTS input. Subtitles always use the real spelling from narration.json.
SAY = [("QoreSign", "Core Sign"), ("QoreChain", "Core Chain"), ("QoreX", "Core X"), ("qorechain", "core chain"),
       ("ML-DSA-87", "M L D S A 87"), ("ML-DSA", "M L D S A"), ("ECDSA", "E C D S A"), ("secp256k1", "S E C P 256 K 1"),
       ("SHA-256", "S H A 256"), ("fUSD", "F U S D"), ("REST API", "rest A P I"), ("SDK", "S D K"), ("pqc_hybrid_verify", "P Q C hybrid verify"),
       ("EthNativeSigner", "Eth Native Signer"), ("4,627", "4627"), ("2,500", "2500"), ("Q-Day", "Q Day"), ("MIT", "M I T"), ("create-core chain-dapp", "create core chain dapp"), ("create-qorechain-dapp", "create core chain dapp")]
def say(t):
    for a, b in SAY: t = t.replace(a, b)
    return t
def sh(*a): subprocess.run(a, check=True)
def dur(p): return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]))
RATE = 22050

def synth(text, path):
    subprocess.run([PIPER, "-m", VOICE, "--no-normalize", "--length-scale", LS, "-f", path], input=say(text).encode(), check=True, capture_output=True)
    with wave.open(path) as w:
        assert w.getframerate() == RATE and w.getnchannels() == 1 and w.getsampwidth() == 2, "unexpected piper format"
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    n = int(0.012 * RATE); x[:n] *= np.linspace(0, 1, n); x[-n:] *= np.linspace(1, 0, n)  # click-free joins
    return x

web = json.load(open(os.path.join(W, "web-marks.json")))
tm = {}
for line in open(os.path.join(W, "term-marks.txt")):
    k, v = line.split(); tm[k] = float(v)
term = {k: v - tm["rec-start"] for k, v in tm.items()}
def t_of(marks, expr):
    m = re.match(r"([\w-]+?)([+-][\d.]+)?$", expr); return max(0.0, marks[m.group(1)] + float(m.group(2) or 0))

scenes = json.load(open(os.path.join(HERE, "narration.json")))
LABEL = "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='WALLET MOCKED FOR RECORDING  (local SDK signer, real testnet tx)':x=w-tw-36:y=30:fontsize=26:fontcolor=white:box=1:boxcolor=0xb45309@0.92:boxborderw=14"
VF_ENC = ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-r", str(FPS), "-pix_fmt", "yuv420p"]

# 1) synthesise + lay out the timeline
t = 0.0; track = []; subs = []; segs = []
for i, s in enumerate(scenes):
    sents = []; c = LEAD
    ss0 = None
    if s["kind"] == "video":
        _k, _a0, _ = s["src"].split(":"); ss0 = t_of(web if _k == "web" else term, _a0)
    for j, text in enumerate(s["sentences"]):
        if isinstance(text, dict):  # {"text":..., "at": "<mark>[+-offset]"}: start no earlier than that footage mark
            c = max(c, t_of(web if s["src"].startswith("web") else term, text["at"]) - ss0); text = text["text"]
        x = synth(text, os.path.join(W, f"vo-{s['id']}-{j}.wav")); a = len(x) / RATE
        sents.append(dict(text=text, x=x, a=a, at=c)); c += a + GAP
    D = c - GAP + TAIL
    s = dict(s, sents=sents, start=t)
    if s["kind"] == "video":
        kind, a0, a1 = s["src"].split(":"); marks = web if kind == "web" else term
        ss, to = t_of(marks, a0), t_of(marks, a1); foot = to - ss
        s.update(kind_src=kind, ss=ss, foot=foot); D = max(D, foot)
    s["D"] = D
    for q in sents:
        track.append((t + q["at"], q["x"])); subs.append((t + q["at"], t + q["at"] + q["a"], q["text"]))
    segs.append(s); t += D
total = t
print(f"total {total:.1f}s", [(s["id"], round(s["D"], 1)) for s in segs])
assert total <= 170, "longer than 2:50"

# 2) visual segments
for i, s in enumerate(segs):
    out = os.path.join(W, f"seg-{i:02d}-{s['id']}.mp4"); s["out"] = out; D = s["D"]
    if s["kind"] == "video":
        vf = [f"tpad=stop_mode=clone:stop_duration={D + 2:.3f}"] + ([LABEL] if s.get("label") else []) + [f"fps={FPS}", "format=yuv420p"]
        sh("ffmpeg", "-y", "-loglevel", "error", "-ss", f"{s['ss']:.3f}", "-t", f"{s['foot']:.3f}", "-i", os.path.join(W, f"{s['kind_src']}.mp4"), "-vf", ",".join(vf), "-t", f"{D:.3f}", "-an", *VF_ENC, out)
        continue
    # still / step-reveal card, with a slow zoom
    frames = []
    if s["kind"] == "still":
        img = os.path.join(REPO, "docs", "cover.png") if s["src"] == "cover" else os.path.join(W, s["src"] + ".png")
        frames = [(img, D)]
    else:
        starts = [0.0] + [q["at"] for q in s["sents"]]
        for k in range(len(starts)):
            end = starts[k + 1] if k + 1 < len(starts) else D
            frames.append((os.path.join(W, f"card-{s['src']}-s{k}.png"), end - starts[k]))
    lst = os.path.join(W, f"frames-{s['id']}.txt")
    with open(lst, "w") as f:
        for p, d in frames: f.write(f"file '{p}'\nduration {d:.3f}\n")
        f.write(f"file '{frames[-1][0]}'\n")
    nfr = int(D * FPS); z = 0.05
    zp = f"zoompan=z='1+{z}*on/{nfr}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps={FPS}"
    sh("ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst, "-vf", f"fps={FPS},scale=3840:2160:flags=lanczos,{zp},format=yuv420p", "-t", f"{D:.3f}", "-an", *VF_ENC, out)

# 3) voice-over track at 22.05 kHz (identical to piper's rate), then resample + loudness-normalise once
vo = np.zeros(int((total + 1) * RATE), dtype=np.float32)
for at, x in track:
    k = int(at * RATE); vo[k:k + len(x)] += x
raw = os.path.join(W, "voiceover-raw.wav")
with wave.open(raw, "wb") as o:
    o.setnchannels(1); o.setsampwidth(2); o.setframerate(RATE); o.writeframes((np.clip(vo, -1, 1) * 32767).astype(np.int16).tobytes())
TARGET = "I=-16:TP=-1.5:LRA=11"
meas = subprocess.run(["ffmpeg", "-hide_banner", "-i", raw, "-af", f"loudnorm={TARGET}:print_format=json", "-f", "null", "-"], capture_output=True, text=True).stderr
m = json.loads(meas[meas.rindex("{"):meas.rindex("}") + 1])
ln = f"loudnorm={TARGET}:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true"
vo48 = os.path.join(W, "voiceover.wav")
sh("ffmpeg", "-y", "-loglevel", "error", "-i", raw, "-af", f"aresample=48000:resampler=soxr,{ln},alimiter=limit=0.80:level=disabled", "-ar", "48000", "-c:a", "pcm_s24le", vo48)

# 4) subtitles (display spelling)
def ts(x): h = int(x // 3600); m_ = int(x % 3600 // 60); return f"{h}:{m_:02d}:{x % 60:05.2f}"
ass = ["[Script Info]", "ScriptType: v4.00+", "PlayResX: 1920", "PlayResY: 1080", "", "[V4+ Styles]",
       "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV",
       "Style: D,Noto Sans,42,&H00FFFFFF,&H00000000,&H99000000,0,3,12,0,2,160,160,48", "", "[Events]", "Format: Layer, Start, End, Style, Text"]
for a, b, text in subs: ass.append(f"Dialogue: 0,{ts(a)},{ts(b + 0.15)},D,{text}")
open(os.path.join(W, "subs.ass"), "w").write("\n".join(ass) + "\n")
with open(os.path.join(W, "concat.txt"), "w") as f:
    for s in segs: f.write(f"file '{s['out']}'\n")
out = os.path.join(VID, "qoresign-demo.mp4")
sh("ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", os.path.join(W, "concat.txt"), "-i", vo48,
   "-vf", f"subtitles={os.path.join(W, 'subs.ass')}", "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-pix_fmt", "yuv420p",
   "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t", f"{total:.3f}", "-movflags", "+faststart", out)
print(out, f"{dur(out):.2f}s", os.path.getsize(out))
json.dump([{"id": s["id"], "start": round(s["start"], 2), "D": round(s["D"], 2)} for s in segs], open(os.path.join(W, "timeline.json"), "w"), indent=1)
