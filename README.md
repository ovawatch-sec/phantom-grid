<div align="center">

<img src="frontend/src/assets/phantom-grid-icon.svg" width="132" alt="PhantomGrid logo">

# PhantomGrid

**Active Directory recon & attack automation — map the domain, harvest the hashes, surface the paths.**

![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)
![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688?logo=fastapi&logoColor=white)
![Angular](https://img.shields.io/badge/Frontend-Angular%2017-DD0031?logo=angular&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)
![AD](https://img.shields.io/badge/Active%20Directory-recon%20%26%20attack-b072ff)

*An [Ovawatch](https://ovawatch.co.za) tool — the Active Directory sibling of [ShadowGrid](https://github.com/ovawatch-sec/shadow-grid).*

</div>

---

## Overview

**PhantomGrid** is a full-stack Active Directory assessment framework. It takes one set of domain credentials (password **or** NTLM hash) and a target DC/host, then walks the engagement through six dependency-ordered phases — host discovery, user/group enumeration, Kerberos attacks, share & service enumeration, BloodHound graph collection, and credential cracking — orchestrating proven tools (**netexec, impacket, ldapdomaindump, bloodhound-python, hashcat**) behind one web UI with live progress and a findings dashboard.

It is the web-driven successor to the **AD-Ovawatch** CLI, rebuilt on the same engine and design system as [ShadowGrid](https://github.com/ovawatch-sec/shadow-grid) — where ShadowGrid maps the *external* attack surface, PhantomGrid maps the *internal* directory.

> The name: Active Directory is a graph of principals and trust/ACL edges. PhantomGrid lights up that grid from a foothold — including the **phantom** nodes (shadow admins, AS-REP-roastable accounts, dangling delegations) defenders forget. The domain-controller diamond at the centre of the logo is the hub everything pivots around.

### Highlights

- **One credential, full pipeline** — authenticate once; PhantomGrid runs every selected phase and hands each phase's output to the next (alive host → users → hashes → cracked creds).
- **Phase gating** — `users.txt` is written from SID enumeration before Kerberos roasting; captured `$krb5asrep$`/`$krb5tgs$` hashes are written before the cracking phase reads them.
- **Live & resumable** — watch every tool report over SSE; cancel a run mid-flight (in-flight processes are terminated).
- **Credential-safe by design** — a scan's password/NTLM hash are handed to the engine **in memory only**. They are never written to storage and never logged (tool command lines that contain secrets are kept out of the logs). Only the domain + username are persisted for audit.
- **Findings dashboard** — hosts, users/groups, Kerberos hashes, SMB shares, service access, LDAP/BloodHound artifacts, and recovered credentials, each in its own tab.

---

## Quick Start (Docker)

```bash
git clone https://github.com/ovawatch-sec/phantom-grid.git
cd phantom-grid

docker compose -f docker/docker-compose.yml up --build -d
```

Open **http://localhost:8080**, then:

1. **Set a password** (required on first visit) and log in.
2. **Create a project** and add **targets** (a DC hostname or IP).
3. Open **Launch Scan**, enter the **domain credentials** (domain / username / password or NTLM hash), pick the AD tools, and launch.
4. Watch **live progress**, then open the **findings dashboard**.

> **Cracking wordlist:** mount a list at `/app/data/wordlists/rockyou.txt` (or set a custom path per scan) to enable the cracking phase, e.g. `-v /usr/share/wordlists/rockyou.txt:/app/data/wordlists/rockyou.txt`.

---

## Scan Phases

| Phase | Tools | Output |
|-------|-------|--------|
| 1 — Host Discovery | `host_discovery` (netexec) | live DC/host + OS/domain info |
| 2 — User & Group Enumeration | `lookupsid` (impacket) | users + groups → `users.txt` |
| 3 — Kerberos Attacks | `asrep_roast` (GetNPUsers), `kerberoast` (GetUserSPNs) | `$krb5asrep$` / `$krb5tgs$` hashes |
| 4 — Shares & Services | `smb_shares`, `winrm_check` (netexec), `ldap_dump` (ldapdomaindump) | shares + permissions, WinRM access, LDAP dump |
| 5 — Graph Collection | `bloodhound` (bloodhound-python) | BloodHound `.zip` for attack-path analysis |
| 6 — Credential Cracking | `crack_asrep` (hashcat 18200), `crack_kerberoast` (hashcat 13100) | recovered `user:password` |

Each phase runs its tools in parallel and writes hand-off artifacts before the dependent phase begins.

---

## Required Tooling

The Docker image bundles everything; for a local/CLI run these must be on `PATH`:

| Tool | Used by |
|------|---------|
| `netexec` (`nxc`) | host discovery, SMB shares, WinRM |
| `impacket-lookupsid` / `-GetNPUsers` / `-GetUserSPNs` | user enumeration, AS-REP roast, Kerberoast |
| `ldapdomaindump` | LDAP directory dump |
| `bloodhound-python` | BloodHound collection |
| `hashcat` | credential cracking |
| `smbclient`, `dig` | share access, DNS |

> A tool that isn't installed is cleanly **skipped** and reported in progress — it never breaks a scan.

---

## CLI Usage

The CLI shares the exact engine and tool layer as the web app.

```bash
cd phantom-grid
pip install -r backend/requirements.txt   # plus the AD tools above on PATH

# Full run against a DC
python3 phantomgrid.py -d CORP.LOCAL -t 10.0.0.10 -u svc-account -p 'P@ssw0rd'

# Pass-the-hash, specific tools, multiple targets
python3 phantomgrid.py -d CORP.LOCAL -t dc01 dc02 -u svc -H <nthash> --tools lookupsid,kerberoast

# With a cracking wordlist
python3 phantomgrid.py -d CORP.LOCAL -t 10.0.0.10 -u svc -p 'P@ss' -w /usr/share/wordlists/rockyou.txt

# List tools and availability
python3 phantomgrid.py --list-tools
```

---

## Authentication & Password Reset

PhantomGrid uses single-password auth for the web UI (no default credentials; set on first visit; 7-day bearer tokens). Reset it offline if forgotten:

```bash
docker exec -it phantomgrid python3 /app/backend/reset_password.py   # or: ./docker/reset-password.sh
```

---

## Architecture

```
Browser (Angular 17)  ──HTTP/SSE──>  FastAPI backend  ──>  AD tool layer (netexec/impacket/…)
  projects · targets                  phased scan engine      one wrapper per tool
  scan form + credentials             single-password auth     parsed → ToolResult
  live progress · findings            file + Azure storage
```

The whole stack ships as a **single container** (Angular build + FastAPI + the AD toolchain + nginx).

---

## Project Structure

```
phantom-grid/
├── backend/            FastAPI app, scan engine, AD tool layer, storage, auth
│   ├── scan_engine.py      6-phase AD orchestration
│   ├── tools/ad_tools.py   one wrapper per AD tool (+ registry.py)
│   └── reset_password.py   offline password-reset utility
├── frontend/           Angular 17 SPA (projects, scans, live progress, findings)
├── docker/             Dockerfile, docker-compose.yml, nginx.conf, entrypoint.sh
├── data/               wordlists and tool data
└── phantomgrid.py      CLI entry point (same engine as the web app)
```

---

## Legal & Ethical Use

PhantomGrid is for **authorised security testing only** — Active Directory environments you own or are explicitly contracted to assess. It performs real authentication, enumeration, Kerberos ticket requests, and offline hash cracking against the target domain. Unauthorised access to computer systems is illegal. **You are solely responsible for how you use this tool.**
