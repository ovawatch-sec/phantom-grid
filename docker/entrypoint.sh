#!/bin/bash
set -e

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║        PhantomGrid  v1.0  Startup        ║"
echo "║        Active Directory · Ovawatch       ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Tool availability check
echo "[ AD tool availability ]"
for t in nxc impacket-lookupsid impacket-GetNPUsers impacket-GetUserSPNs \
          ldapdomaindump bloodhound-python hashcat smbclient dig; do
    if command -v "$t" &>/dev/null; then
        echo "  ✓  $t"
    else
        echo "  ✗  $t (not installed — the matching tool will be skipped)"
    fi
done

# Cracking needs a wordlist mounted at the default path.
if [ ! -s /app/data/wordlists/rockyou.txt ]; then
    echo "  !  /app/data/wordlists/rockyou.txt not found — the cracking phase will"
    echo "     have no default wordlist. Mount one there or set a path per scan."
fi
echo ""

# Start FastAPI backend
echo "[ Starting backend on :8000 ]"
cd /app/backend
python3 -m uvicorn main:app \
    --host 127.0.0.1 \
    --port 8000 \
    --log-level warning &
BACKEND_PID=$!

# Wait up to 30s for backend
echo "[ Waiting for backend... ]"
for i in $(seq 1 30); do
    if curl -sf http://127.0.0.1:8000/api/health > /dev/null 2>&1; then
        echo "[ Backend ready ]"
        break
    fi
    sleep 1
done

if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo "ERROR: Backend failed to start."
    exit 1
fi

echo "[ Starting Nginx on :80 ]"
echo "[ Web UI → http://localhost:8080 (mapped from container :80) ]"
echo ""
exec nginx -g "daemon off;"
