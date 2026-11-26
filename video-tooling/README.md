# Demo video tooling

Rebuilds `../video/qoresign-demo.mp4` (outside the repo) from real recordings.

| File | What it does |
| --- | --- |
| `record-web.mjs` | Records the web app on a virtual display (Xvfb, `DISPLAY_REC`, default `:99`) with ffmpeg x11grab. **The QoreX wallet is mocked for the recording**: `window.qorex.native` is a stub whose `signArbitrary` / `signAndBroadcast` are done by the local testnet wallet through the QoreChain SDK (`anchor.mts`). The anchor tx is a real, committed hybrid-signed tx on `qorechain-diana`. The video labels this on screen. |
| `anchor.mts` | The stub's `signAndBroadcast`: hybrid-signed (secp256k1 + ML-DSA-87) 1 uqor self-send with the requested memo, broadcast to testnet; `shield` is derived from the committed tx tier. |
| `record-term.sh` / `term-demo.sh` | Fullscreen xterm capture of real CLI runs: `status`, a fresh `issue` (7 checks), a REST read-back of the anchor tx, `npm test`. |
| `cards.html` | Architecture, post-quantum checks and outro cards (rendered with headless Chrome). |
| `narration.json` | Narration per scene and which footage it covers. |
| `select_voice.py` | Re-synthesises each narration sentence and keeps the Piper take whose Whisper (`faster-whisper` base) transcript has the lowest word error rate. Accepted wavs: `../video/work/accepted-vo/`. |
| `build.py` | Piper TTS voice-over (separate spoken and display text, step-by-step reveal cards) (`en_US-ryan-high`, synthesised per sentence, loudness-normalised to -16 LUFS / -1.5 dBTP). Prefers Whisper-checked takes. Scene cuts, burned-in subtitles, ffmpeg concat. |

```bash
Xvfb :99 -screen 0 1920x1080x24 &   # never the desktop display
npm run dev &
node video-tooling/record-web.mjs
video-tooling/record-term.sh
for c in arch pq outro; do google-chrome --headless=new --no-sandbox --hide-scrollbars --window-size=1920,1080 \
  --screenshot=../video/work/card-$c.png "file://$PWD/video-tooling/cards.html#$c"; done
python3 video-tooling/select_voice.py   # optional: pick Whisper-checked takes (needs faster-whisper)
python3 video-tooling/build.py      # needs piper-tts (PIPER=..., PIPER_VOICE=...) and ffmpeg with libass
```

Each recording spends about 0.02 test QOR (testnet only, no value).
