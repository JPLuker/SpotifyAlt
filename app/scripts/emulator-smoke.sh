#!/usr/bin/env bash
# Installs the x86_64 debug APK on a running emulator, opens the app on the real
# open.spotify.com, and checks the log: GeckoView started, the Heartline extension
# connected, and what the Widevine check said. Saves a screenshot and the log.
# Usage: app/scripts/emulator-smoke.sh <apk> <out-dir>
set -euo pipefail
apk="$1"
out="$2"
mkdir -p "$out"

adb wait-for-device
adb shell 'while [[ -z $(getprop sys.boot_completed) ]]; do sleep 1; done'
adb install -r "$apk"
adb logcat -c
adb shell am start -W -n com.jpluker.spotifyalt/.MainActivity
# Notification permission prompt (API 33+): allow it so the media card can show.
adb shell pm grant com.jpluker.spotifyalt android.permission.POST_NOTIFICATIONS || true

connected=no
for _ in $(seq 1 90); do
  if adb logcat -d -s SpotifyAlt:I | grep -q "Heartline connected"; then connected=yes; break; fi
  sleep 2
done
sleep 20 # let the page settle; the layout report comes 12 s after load

adb exec-out screencap -p > "$out/emulator-player.png"
adb logcat -d > "$out/logcat.txt"
grep -E "SpotifyAlt|GeckoConsole|Heartline" "$out/logcat.txt" | tail -n 80 > "$out/app-log.txt" || true

# A small copy of the screenshot in the job log, so it can be read without the artifact store.
small="$out/emulator-player-small.jpg"
if command -v magick >/dev/null; then
  magick "$out/emulator-player.png" -resize 480x -quality 75 "$small"
elif command -v convert >/dev/null; then
  convert "$out/emulator-player.png" -resize 480x -quality 75 "$small"
elif command -v ffmpeg >/dev/null; then
  ffmpeg -loglevel error -y -i "$out/emulator-player.png" -vf scale=480:-1 -q:v 4 "$small"
else
  small="$out/emulator-player.png"
fi
echo "SCREENSHOT-BEGIN"
base64 -w 76 "$small"
echo "SCREENSHOT-END"

echo "--- app log (tail)"
cat "$out/app-log.txt"

if [[ "$connected" != yes ]]; then
  echo "::error::The Heartline extension never connected to the app"
  exit 1
fi
echo "--- layout report"
grep -o "Heartline layout [0-9]*: .*" "$out/logcat.txt" || echo "(none)"
diag=$(grep -o "Heartline diag: .*" "$out/logcat.txt" | tail -n 1 || true)
if [[ -z "$diag" ]]; then
  echo "::error::No Widevine check result in the log"
  exit 1
fi
echo "$diag"
if [[ "$diag" == *"widevine=true"* ]]; then
  echo "Widevine: available"
else
  # Emulator images don't always ship Widevine; the phone is the real test. Flag it, don't fail.
  echo "::warning::Widevine not available on this emulator: $diag"
fi
# The layout report is logged in chunks; join them and check the numbers.
python3 - "$out/logcat.txt" <<'PY' || exit 1
import json, re, sys
parts = {}
for line in open(sys.argv[1], errors="replace"):
    m = re.search(r"Heartline layout (\d+): (.*)$", line.rstrip("\n"))
    if m:
        parts[int(m.group(1))] = m.group(2)
if not parts:
    print("::error::No layout report in the log"); sys.exit(1)
d = json.loads("".join(parts[k] for k in sorted(parts)))
for k in sorted(d):
    if k not in ("outline", "bodyText"):
        print(f"{k} = {d[k]}")
problems = []
if not d.get("cssLoaded"): problems.append("Heartline CSS not loaded")
if (d.get("innerWidth") or 9999) > 500: problems.append(f"page is {d.get('innerWidth')} px wide, should be about the screen width")
if d.get("mainBg") not in ("rgb(25, 25, 24)", None): problems.append(f"restyle not on the main view ({d.get('mainBg')})")
# Nav must sit fully above the page: nav top + height <= main top.
boxes = d.get("navBoxes") or []
try:
    nav_top, nav_h = map(float, boxes[0].split(":")[1].split(" ")[0].split("+"))
    main_top = float(boxes[-1].split(":")[1].split("+")[0])
    if nav_top < 0 or nav_top + nav_h > main_top + 1:
        problems.append(f"nav ({nav_top}+{nav_h}) overlaps the page (starts at {main_top})")
except (IndexError, ValueError) as err:
    print(f"::warning::Couldn't read nav boxes: {err}")
if d.get("baseVar", "").lower() not in ("#191918", "rgb(25, 25, 24)", "var(--hl-surface)"): print(f"::warning::--background-base on the theme root is {d.get('baseVar')}")
for p in problems: print(f"::error::{p}")
sys.exit(1 if problems else 0)
PY
if grep -q "google-analytics.com/g/collect" "$out/logcat.txt"; then
  echo "::warning::Google Analytics still loaded; tracker blocking isn't catching it"
fi
# Only our own crashes count; the emulator's launcher sometimes crashes on its own.
if grep -A3 "FATAL EXCEPTION" "$out/logcat.txt" | grep -q "Process: com.jpluker.spotifyalt" \
  || grep -q "Page process crashed" "$out/logcat.txt"; then
  grep -A12 "FATAL EXCEPTION" "$out/logcat.txt" | head -40
  echo "::error::Crash in the log"
  exit 1
fi
echo "Emulator smoke test passed"

# Evaluation (no pass/fail): the same app on Spotify's phone site, to compare as a base.
echo "--- phone site run"
adb shell am force-stop com.jpluker.spotifyalt
adb logcat -c
adb shell am start -W -n com.jpluker.spotifyalt/.MainActivity --ez debug_mobile_site true
sleep 45
adb exec-out screencap -p > "$out/emulator-phone-site.png"
adb logcat -d > "$out/logcat-phone-site.txt"
grep -E "Debug: loading|Heartline (connected|diag)" "$out/logcat-phone-site.txt" || true
python3 - "$out/logcat-phone-site.txt" <<'PY' || true
import json, re, sys
parts = {}
for line in open(sys.argv[1], errors="replace"):
    m = re.search(r"Heartline layout (\d+): (.*)$", line.rstrip("\n"))
    if m:
        parts[int(m.group(1))] = m.group(2)
if parts:
    d = json.loads("".join(parts[k] for k in sorted(parts)))
    for k in ("userAgent", "title", "innerWidth", "bodyText"):
        print(f"phone site {k} = {d.get(k)}")
PY
small2="$out/phone-site-small.jpg"
if command -v magick >/dev/null; then magick "$out/emulator-phone-site.png" -resize 480x -quality 75 "$small2"
elif command -v convert >/dev/null; then convert "$out/emulator-phone-site.png" -resize 480x -quality 75 "$small2"
elif command -v ffmpeg >/dev/null; then ffmpeg -loglevel error -y -i "$out/emulator-phone-site.png" -vf scale=480:-1 -q:v 4 "$small2"
else small2="$out/emulator-phone-site.png"; fi
echo "SCREENSHOT2-BEGIN"; base64 -w 76 "$small2"; echo "SCREENSHOT2-END"
