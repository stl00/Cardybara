#!/usr/bin/env bash
# Owner-only, once (and again to rotate): sets the hourly alert check's two tokens as Worker secrets (#259, #371).
# Reads GATEWAY_GITHUB_TOKEN (fine-grained, Issues: write on stl00/Cardybara only) and GATEWAY_ANALYTICS_SQL_TOKEN
# (Cloudflare API token with Account Analytics: Read) from the env file named by $CARDYBARA_ALERT_SECRETS and pipes
# each straight to `wrangler secret put GITHUB_TOKEN` / `ANALYTICS_SQL_TOKEN`. The values are never printed, echoed,
# logged or written anywhere else; only the names set are reported. A name missing from the file is skipped, so the
# two can be set one at a time. CF_ACCOUNT_ID is not a credential and is set by the orchestrator.
# Needs `wrangler login` (or CLOUDFLARE_API_TOKEN) for the account that runs the Worker, and Node 22 for wrangler.
#   CARDYBARA_ALERT_SECRETS=/path/to/.env.local scripts/gateway-set-alert-secrets.sh
set -euo pipefail
set +x
config="${CARDYBARA_ALERT_SECRETS:-}"
if [[ -z "$config" || ! -f "$config" ]]; then echo "Set CARDYBARA_ALERT_SECRETS to the env file that holds GATEWAY_GITHUB_TOKEN and/or GATEWAY_ANALYTICS_SQL_TOKEN." >&2; exit 2; fi
root="$(cd "$(dirname "$0")/.." && pwd)"
# Prints only the value of one line, to the pipe; strips optional quotes. Exits 3 when the line is missing or short.
read_value() { node -e '
const t=require("fs").readFileSync(process.argv[1],"utf8");
const m=t.split("\n").map(l=>l.match(new RegExp("^\\s*"+process.argv[2]+"\\s*=\\s*(.*?)\\s*$"))).find(Boolean);
const v=m&&m[1].replace(/^(["\x27])(.*)\1$/,"$2");
if(!v||v.length<16)process.exit(3);
process.stdout.write(v);' "$config" "$1"; }
set_count=0
for pair in GATEWAY_GITHUB_TOKEN:GITHUB_TOKEN GATEWAY_ANALYTICS_SQL_TOKEN:ANALYTICS_SQL_TOKEN; do
  from="${pair%%:*}" to="${pair##*:}"
  if ! read_value "$from" >/dev/null; then echo "No usable $from in that file; $to left as it is." >&2; continue; fi
  read_value "$from" | npx --yes wrangler@4.150.0 secret put "$to" --config "$root/gateway/wrangler.jsonc" >/dev/null
  echo "$to set on cardybara-gateway from $from."
  set_count=$((set_count+1))
done
[[ $set_count -gt 0 ]] || exit 3
