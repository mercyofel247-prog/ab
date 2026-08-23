#!/bin/bash
# PreToolUse(Bash) gate: force an explicit confirmation before any HyperFrames
# CLOUD render, because it spends the HeyGen wallet. Read-only cloud subcommands
# (list/get) and --dry-run builds are exempt (they cost nothing). Local renders
# are never gated here.
#
# Emits a PreToolUse permission decision of "ask" so the user must confirm each
# time; on anything else it stays silent and the command proceeds normally.
set -euo pipefail

input="$(cat)"
cmd="$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log((JSON.parse(s).tool_input||{}).command||"")}catch(e){console.log("")}})')"

# Dry runs build a zip but never upload or bill — let them through.
if printf '%s' "$cmd" | grep -Eq -- '--dry-run'; then
  exit 0
fi

# Match a real cloud-render submission, via the CLI (`hyperframes … cloud render`)
# or the npm scripts (`npm run cloud` / `npm run cloud:wait`). The read-only
# `cloud list` / `cloud get` and `cloud:list` / `cloud:get` do not match.
if printf '%s' "$cmd" | grep -Eq -- '(hyperframes[^|;&]*cloud[[:space:]]+render)|(npm[[:space:]]+run[[:space:]]+cloud(:wait)?([[:space:]]|$|--))'; then
  cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"This starts a HyperFrames CLOUD render, which spends your HeyGen wallet. Confirm to submit, or deny to cancel."}}
JSON
fi
exit 0
