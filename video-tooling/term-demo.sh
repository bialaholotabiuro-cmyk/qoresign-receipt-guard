#!/usr/bin/env bash
# Terminal part of the demo video: real CLI runs against qorechain-diana.
# Run inside a recorded xterm (see record-term.sh). Writes scene marks to $MARKS.
cd "$(dirname "$0")/.."
unset NO_COLOR; export FORCE_COLOR=1
REST=https://api-testnet.qore.host
mark() { echo "$1 $(date +%s.%N)" >> "$MARKS"; }
type_cmd() { printf '\033[1;32m$\033[0m '; local s="$1"; for ((i=0;i<${#s};i++)); do printf '%s' "${s:i:1}"; sleep 0.025; done; sleep 0.5; echo; }
run() { type_cmd "$1"; eval "$1"; }
clear; mark t-start; sleep 1
run 'npm run --silent cli -- status'
sleep 3; mark t-issue
type_cmd 'npm run --silent cli -- issue --title "Receipt #2026-015 - CLI demo" --amount 99.00 --currency fUSD'
npm run --silent cli -- issue --title "Receipt #2026-015 - CLI demo" --amount 99.00 --currency fUSD | tee /tmp/qrg-issue.log
TX=$(grep -o 'anchored: [0-9A-F]*' /tmp/qrg-issue.log | cut -d' ' -f2); echo "$TX" > "$MARKS.tx"
mark t-issue-done; sleep 7
clear; mark t-rest
echo -e '\033[2m# read the anchor tx back from the public REST API (no wallet, no app)\033[0m'
run "curl -s \$REST/cosmos/tx/v1beta1/txs/$TX | jq '.tx_response | {height, code, memo: .tx.body.memo, pqc_hybrid_verify: (.events[] | select(.type==\"pqc_hybrid_verify\") | .attributes | map({(.key): .value}) | add)}'"
sleep 9; mark t-tests
clear
run "npm test -- --reporter=verbose"
mark t-tests-done; sleep 6
mark t-end
