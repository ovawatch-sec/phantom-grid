# ═══════════════════════════════════════════════════════════════════
# PhantomGrid — Active Directory recon/attack framework
# Stage 1 : Build Angular frontend
# Stage 2 : Final runtime image (FastAPI + AD toolchain + nginx)
# ═══════════════════════════════════════════════════════════════════

# ── Stage 1: Angular Build ──────────────────────────────────────
FROM node:20-alpine AS frontend-build

WORKDIR /build/frontend
COPY frontend/package.json ./
RUN npm install --no-audit --no-fund

COPY frontend/ ./
RUN npm run build


# ── Stage 2: Final Runtime Image ─────────────────────────────────
FROM debian:bookworm-slim

LABEL org.opencontainers.image.title="PhantomGrid"
LABEL org.opencontainers.image.version="1.0.0"
LABEL org.opencontainers.image.description="Active Directory recon & attack framework — Angular + FastAPI + Docker (Ovawatch)"

# System packages.
#   smbclient, hashcat, krb5-user  → AD tooling at runtime
#   gcc/python3-dev/libffi/libssl/libkrb5-dev → build deps for impacket/netexec wheels
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    nginx \
    curl \
    ca-certificates \
    smbclient \
    hashcat \
    dnsutils \
    whois \
    netbase \
    krb5-user \
    libkrb5-dev \
    gcc \
    python3-dev \
    libffi-dev \
    libssl-dev \
    build-essential \
    git \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Python backend deps
WORKDIR /app
COPY backend/ ./backend/
RUN pip3 install --no-cache-dir --break-system-packages -r backend/requirements.txt

# ── Active Directory toolchain (Python) ──────────────────────────
#   impacket          → lookupsid / GetNPUsers / GetUserSPNs
#   netexec (nxc)     → SMB/WinRM enumeration & share listing
#   bloodhound        → provides the bloodhound-python collector
#   ldapdomaindump    → LDAP directory dump
RUN pip3 install --no-cache-dir --break-system-packages \
      impacket==0.12.0 \
      netexec \
      bloodhound \
      ldapdomaindump

# impacket installs its example scripts as <Name>.py — expose them under the
# impacket-<Name> names PhantomGrid's tool wrappers invoke.
RUN for s in GetNPUsers GetUserSPNs lookupsid; do \
      src="$(command -v ${s}.py || true)"; \
      if [ -n "$src" ]; then ln -sf "$src" /usr/local/bin/impacket-${s}; fi; \
    done

# Angular frontend — Angular 17 application builder outputs to dist/<name>/browser/
COPY --from=frontend-build /build/frontend/dist/phantomgrid/ ./frontend/dist/phantomgrid/

# Nginx config
COPY docker/nginx.conf /etc/nginx/sites-enabled/default

# Data directories (mount a real wordlist at /app/data/wordlists/rockyou.txt for cracking)
RUN mkdir -p /app/output /app/data/wordlists
COPY data/ /app/data/

# Entrypoint
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80

ENTRYPOINT ["/entrypoint.sh"]
