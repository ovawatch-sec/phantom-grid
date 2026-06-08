#!/bin/bash
# reset-password.sh — reset the PhantomGrid login password inside the running container.
#
# The auth record lives in the `phantomgrid-output` Docker volume, so the reset
# must run in the container's context. This wraps the interactive Python tool.
#
# Usage:
#   ./reset-password.sh                 # interactive prompt
#   ./reset-password.sh --keep-sessions # don't log out existing sessions
#
# Any extra arguments are forwarded to reset_password.py.
set -euo pipefail

CONTAINER="${PHANTOMGRID_CONTAINER:-phantomgrid}"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    echo "Error: container '$CONTAINER' is not running." >&2
    echo "Start it first (docker compose up -d) or set PHANTOMGRID_CONTAINER." >&2
    exit 1
fi

exec docker exec -it "$CONTAINER" python3 /app/backend/reset_password.py "$@"
