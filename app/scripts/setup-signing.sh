#!/usr/bin/env bash
# One-time Android signing setup for SpotifyAlt. Joseph runs this on a trusted machine
# (his laptop or Termux), never an agent. The key and password stay on that machine,
# go to GitHub only as Actions secrets, and are never printed or committed.
#
# Run it with the one-line format (SECURITY-BASELINE.md 2.1):
#   gh repo clone JPLuker/SpotifyAlt && cd SpotifyAlt && bash app/scripts/setup-signing.sh
#
# Safe to run again: it reuses the existing key and just re-uploads the secrets.
#
# From InternalDesignGuidelines/templates/setup-signing.sh, with the four values
# below filled in.
set -euo pipefail
umask 077

# ---- Fill these in for the project -------------------------------------------
project="spotifyalt"                       # folder name for the key
repo="${SIGNING_REPOSITORY:-JPLuker/SpotifyAlt}"
prefix="SPOTIFYALT_ANDROID"              # secret name prefix
dname="CN=SpotifyAlt Android,O=SpotifyAlt"  # certificate subject; public, shows in the APK
# -------------------------------------------------------------------------------

alias_name="${project}-release"
directory="${XDG_DATA_HOME:-$HOME/.local/share}/${project}/android-signing"
keystore="$directory/${project}-release.jks"
password_file="$directory/keystore-password"

missing=()
for command in gh keytool openssl base64; do
  command -v "$command" >/dev/null || missing+=("$command")
done
if (( ${#missing[@]} )); then
  echo "Missing: ${missing[*]}" >&2
  if [[ -n "${TERMUX_VERSION:-}" ]]; then
    echo "Install with: pkg install gh openjdk-17 openssl-tool coreutils" >&2
  else
    echo "Install with: sudo apt install gh openjdk-17-jre-headless openssl coreutils" >&2
  fi
  exit 1
fi
gh auth status >/dev/null 2>&1 || { echo "Not signed in to GitHub. Run: gh auth login" >&2; exit 1; }

mkdir -p "$directory"

if [[ -e "$keystore" && ! -f "$password_file" ]] || [[ ! -e "$keystore" && -f "$password_file" ]]; then
  echo "Signing files are incomplete in $directory. Restore both from your backup, then run this again." >&2
  exit 1
fi

if [[ ! -e "$keystore" ]]; then
  export SIGNING_PASSWORD="$(openssl rand -hex 32)"
  printf '%s\n' "$SIGNING_PASSWORD" > "$password_file"
  keytool -genkeypair -noprompt \
    -keystore "$keystore" -storetype PKCS12 \
    -alias "$alias_name" -keyalg RSA -keysize 3072 -validity 20000 \
    -dname "$dname" \
    -storepass:env SIGNING_PASSWORD \
    -keypass:env SIGNING_PASSWORD >/dev/null 2>&1
  created="yes"
else
  export SIGNING_PASSWORD="$(cat "$password_file")"
  created="no"
fi

# Never print the password or the keystore. Only the public fingerprint is shown.
fingerprint="$(keytool -list -v -keystore "$keystore" \
  -alias "$alias_name" -storepass:env SIGNING_PASSWORD 2>/dev/null \
  | sed -n 's/^[[:space:]]*SHA256: //p' | head -n 1 | tr -d ':[:space:]' | tr '[:upper:]' '[:lower:]')"
[[ "$fingerprint" =~ ^[0-9a-f]{64}$ ]] || { echo "Couldn't read the key's fingerprint. Check the files in $directory." >&2; exit 1; }

# Secrets go in through stdin, never as command-line arguments.
base64 < "$keystore" | tr -d '\n' | gh secret set "${prefix}_KEYSTORE_B64" --repo "$repo"
printf '%s' "$SIGNING_PASSWORD" | gh secret set "${prefix}_STORE_PASSWORD" --repo "$repo"
printf '%s' "$SIGNING_PASSWORD" | gh secret set "${prefix}_KEY_PASSWORD" --repo "$repo"
printf '%s' "$alias_name"       | gh secret set "${prefix}_KEY_ALIAS" --repo "$repo"
printf '%s' "$fingerprint"      | gh secret set "${prefix}_CERT_SHA256" --repo "$repo"
unset SIGNING_PASSWORD

echo
if [[ "$created" == "yes" ]]; then
  echo "New signing key created and uploaded to $repo."
else
  echo "Existing signing key re-uploaded to $repo."
fi
echo "Certificate SHA-256: $fingerprint"
echo
echo "Back up BOTH of these somewhere safe. Losing either one means future builds can't install over this one:"
echo "  $keystore"
echo "  $password_file"
echo
echo "Next build: gh workflow run android.yml --repo $repo --ref main"
