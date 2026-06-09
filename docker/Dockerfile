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
#   python3-impacket      → impacket-lookupsid / -GetNPUsers / -GetUserSPNs
#   python3-ldapdomaindump → ldapdomaindump
#   smbclient, hashcat, krb5-user → SMB access, cracking, Kerberos
#   build deps (gcc/libffi/libssl/python3-dev) → for the pipx-built tools below
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    python3-impacket \
    python3-ldapdomaindump \
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

# ── AD tools not in Debian: install isolated via pipx ────────────
# Isolated venvs avoid clashing with the apt-installed impacket.
#   netexec (nxc)     → SMB/WinRM enumeration & share listing (from upstream git)
#   bloodhound        → provides the bloodhound-python collector
ENV PATH=/root/.local/bin:$PATH
RUN pip3 install --no-cache-dir --break-system-packages pipx \
    && pipx install bloodhound \
    && pipx install git+https://github.com/Pennyw0rth/NetExec.git

# impacket's lookupsid/GetNPUsers/GetUserSPNs aren't packaged standalone on Debian.
# The NetExec venv bundles them (with its own impacket) — expose under impacket-* names.
RUN NXC_BIN=/root/.local/share/pipx/venvs/netexec/bin; \
    for s in lookupsid GetNPUsers GetUserSPNs; do \
      ln -sf "$NXC_BIN/${s}.py" /usr/local/bin/impacket-${s}; \
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
