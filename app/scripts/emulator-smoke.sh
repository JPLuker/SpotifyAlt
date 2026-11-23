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
if grep -q "google-analytics.com/g/collect" "$out/logcat.txt"; then
  echo "::warning::Google Analytics still loaded; tracker blocking isn't catching it"
fi
if grep -qE "FATAL EXCEPTION|Page process crashed" "$out/logcat.txt"; then
  echo "::error::Crash in the log"
  exit 1
fi
echo "Emulator smoke test passed"
