#!/bin/sh
# ARTEX supervisor start script (Linux / macOS / Docker ENTRYPOINT)
#
# Usage:
#   ./start.sh                       run in the foreground (Ctrl-C to stop)
#   nohup ./start.sh >artex.log 2>&1 &   keep running in the background
#   ./start.sh -addr :9000           extra arguments are passed through to artex unchanged
#
# It does exactly one thing: run artex, and when the process exits, decide from the exit code whether to start it again.
#
#   0      normal stop by the user  → leave the loop
#   75     restart requested        → rerun immediately ("One-click update" or "Roll back" was clicked in the UI)
#   other  crash                    → rerun after a backoff (1→2→4… up to 60 seconds)
#
# Downloading, SHA256 verification and swapping binaries are deliberately NOT done here: that logic would have to be written twice (sh and bat),
# and it is exactly the part that must never go wrong: once a binary that cannot run is swapped in, this script will faithfully
# relaunch it over and over, and the user has to log in to the machine to fix it by hand. So verification/swapping stay entirely in Go (the selfupdate package)
# and are done by artex itself at startup; the script stays dumb.
set -u

cd "$(dirname "$0")" || exit 1

BIN=./artex
[ -x "$BIN" ] || { echo "[artex] executable not found: $BIN" >&2; exit 1; }

RESTART_CODE=75
MAX_DELAY=60

child=0
stopping=0

# Forward stop signals to the artex process itself.
#
# This is required under Docker: docker stop only sends SIGTERM to PID 1 (i.e. this script),
# not to its children. Without forwarding, artex never gets the signal, cannot shut down gracefully, and is SIGKILLed
# after 10 seconds, cutting running tasks off halfway.
forward() {
	stopping=1
	if [ "$child" -ne 0 ]; then
		kill -TERM "$child" 2>/dev/null || true
	fi
}
trap forward INT TERM

delay=1
while :; do
	"$BIN" "$@" &
	child=$!

	# A signal interrupts wait and makes it return >128. The child is actually still shutting down gracefully at that point,
	# so we must wait once more to get its real exit code.
	wait "$child"
	code=$?
	if [ "$code" -gt 128 ]; then
		wait "$child"
		code=$?
	fi
	child=0

	if [ "$stopping" -eq 1 ]; then
		echo "[artex] stopped"
		exit 0
	fi

	case "$code" in
		0)
			echo "[artex] exited normally"
			exit 0
			;;
		"$RESTART_CODE")
			# Update/rollback is staged: on rerun, artex swaps in the new binary at startup (see selfupdate.Bootstrap).
			echo "[artex] restart requested (applying new version)..."
			delay=1
			;;
		*)
			echo "[artex] exited abnormally (code=$code), restarting in ${delay}s" >&2
			sleep "$delay"
			delay=$((delay * 2))
			[ "$delay" -gt "$MAX_DELAY" ] && delay=$MAX_DELAY
			;;
	esac
done
