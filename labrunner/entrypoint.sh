#!/bin/sh
# Explicit activation required: FIBERSCOPE_LAB_ENABLE=1 and a token file.
set -eu
: "${FIBERSCOPE_LAB_ENABLE:?set FIBERSCOPE_LAB_ENABLE=1 to activate the lab}"
: "${FIBERSCOPE_LAB_RUNNER_TOKEN:?set FIBERSCOPE_LAB_RUNNER_TOKEN (>=32 chars)}"
umask 077
mkdir -p /run/fiberscope-lab
printf '%s' "$FIBERSCOPE_LAB_RUNNER_TOKEN" > /run/fiberscope-lab/token
python3 /opt/fiberscope/fiberscope_labrunner.py setup --i-understand
trap 'python3 /opt/fiberscope/fiberscope_labrunner.py teardown --i-understand' EXIT INT TERM
python3 /opt/fiberscope/fiberscope_labrunner.py serve --token-file /run/fiberscope-lab/token --i-understand
