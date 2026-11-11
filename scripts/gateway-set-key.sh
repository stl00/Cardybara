#!/usr/bin/env bash
# Owner-only, once (and again to rotate): sets the gateway's provider key as a Worker secret.
# Reads DEEPSEEK_GATEWAY_API_KEY, or else DEEPSEEK_API_KEY, from the env file named by $CARDYBARA_MODEL_CONFIG
# (the same file the local server uses). A separate gateway key with its own spend limit at the provider is
# recommended, so gateway spend is capped there too and told apart from personal use and pipes it straight to `wrangler secret put`. The key is never printed, echoed, logged or written
# anywhere else. Needs `wrangler login` (or CLOUDFLARE_API_TOKEN) for the account that runs the Worker.
#   CARDYBARA_MODEL_CONFIG=/path/to/.env.local scripts/gateway-set-key.sh
set -euo pipefail
set +x
config="${CARDYBARA_MODEL_CONFIG:-}"
if [[ -z "$config" || ! -f "$config" ]]; then echo "Set CARDYBARA_MODEL_CONFIG to the env file that holds DEEPSEEK_GATEWAY_API_KEY or DEEPSEEK_API_KEY." >&2; exit 2; fi
root="$(cd "$(dirname "$0")/.." && pwd)"
# Prints only the value, to the pipe; strips optional quotes. Exits 3 when the line is missing.
read_key() { node -e '
const t=require("fs").readFileSync(process.argv[1],"utf8");
const line=n=>t.split("\n").map(l=>l.match(new RegExp("^\\s*"+n+"\\s*=\\s*(.*?)\\s*$"))).find(Boolean);
const m=line("DEEPSEEK_GATEWAY_API_KEY")||line("DEEPSEEK_API_KEY");
const v=m&&m[1].replace(/^(["\x27])(.*)\1$/,"$2");
if(!v||v.length<16)process.exit(3);
process.stdout.write(v);' "$config"; }
if ! read_key >/dev/null; then echo "No usable DEEPSEEK_GATEWAY_API_KEY or DEEPSEEK_API_KEY in that file." >&2; exit 3; fi
read_key | npx --yes wrangler@4.150.0 secret put PROVIDER_KEY --config "$root/gateway/wrangler.jsonc" >/dev/null
echo "PROVIDER_KEY set on cardybara-gateway."
