#!/usr/bin/env bash
# Records term-demo.sh in a fullscreen xterm on a virtual display (default :99) with ffmpeg x11grab.
set -e
DISP=${DISPLAY_REC:-:99}
OUT=${OUT_DIR:-$(cd "$(dirname "$0")/../../video" && pwd)/work}
mkdir -p "$OUT"; export MARKS="$OUT/term-marks.txt"; rm -f "$MARKS"
ffmpeg -y -loglevel error -f x11grab -draw_mouse 0 -framerate 30 -video_size 1920x1080 -i "$DISP" -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p "$OUT/term.mp4" &
FF=$!; echo "rec-start $(date +%s.%N)" >> "$MARKS"
DISPLAY=$DISP xterm -geometry 200x60+0+0 -maximized -fa 'DejaVu Sans Mono' -fs 17 -bg '#0b1020' -fg '#e8ecf6' -bd '#0b1020' -b 30 +sb \
  -e bash -c "MARKS=$MARKS $(dirname "$0")/term-demo.sh"
sleep 0.5; kill -INT $FF; wait $FF || true
