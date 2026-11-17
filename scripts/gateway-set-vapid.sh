#!/usr/bin/env bash
# Owner-only, once: creates the gateway's VAPID key pair for Web Push reminders (#380) and stores it as the Worker
# secrets VAPID_PRIVATE_KEY and VAPID_PUBLIC_KEY. The private key goes straight into `wrangler secret put` and is
# never printed, echoed, logged or written to a file; only the public key is printed (the web wallet gets it from
# GET /v1/push/key). Needs `wrangler login` (or CLOUDFLARE_API_TOKEN) for the account that runs the Worker.
#   scripts/gateway-set-vapid.sh
# Replacing an existing pair invalidates every device's subscription (the push services reject a different key), so
# the script refuses unless the secret is absent or ROTATE=1 is set.
set -euo pipefail
set +x
root="$(cd "$(dirname "$0")/.." && pwd)"
wrangler=(npx --yes wrangler@4.150.0)
config="$root/gateway/wrangler.jsonc"
if [[ "${ROTATE:-}" != 1 ]] && "${wrangler[@]}" secret list --config "$config" 2>/dev/null | grep -q '"VAPID_PRIVATE_KEY"'; then
  echo "VAPID_PRIVATE_KEY already exists. Rotating it invalidates every subscription; run with ROTATE=1 to do it anyway." >&2
  exit 4
fi
pair="$(node "$root/scripts/gateway-vapid.mjs")"
field() { printf '%s' "$pair" | node -e 'let t="";process.stdin.on("data",d=>t+=d).on("end",()=>process.stdout.write(JSON.parse(t)[process.argv[1]]))' "$1"; }
field private | "${wrangler[@]}" secret put VAPID_PRIVATE_KEY --config "$config" >/dev/null
public="$(field public)"
printf '%s' "$public" | "${wrangler[@]}" secret put VAPID_PUBLIC_KEY --config "$config" >/dev/null
unset pair
echo "VAPID_PRIVATE_KEY and VAPID_PUBLIC_KEY set on cardybara-gateway. Public key: $public"
