#!/usr/bin/env python3
"""
phantomgrid.py — command-line entry point for the PhantomGrid AD engine.

Same scan engine and tool layer as the web app — only the entry point differs.
Authenticate to a domain (password or NTLM hash), then run the selected AD phases
against one or more target hosts/DCs.

Examples
--------
    python3 phantomgrid.py -d CORP.LOCAL -t 10.0.0.10 -u svc -p 'P@ss'
    python3 phantomgrid.py -d CORP.LOCAL -t dc01 dc02 -u svc -H <nthash> --tools lookupsid,kerberoast
    python3 phantomgrid.py --list-tools
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "backend"))

from models import Project, Scan, ScanStatus, DEFAULT_AD_TOOLS  # noqa: E402
from storage import DualStorage  # noqa: E402
from tools.registry import list_tools  # noqa: E402
import scan_engine  # noqa: E402


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="phantomgrid.py", description="PhantomGrid — Active Directory recon/attack CLI")
    p.add_argument("-d", "--domain", default="", help="AD domain, e.g. CORP.LOCAL")
    p.add_argument("-t", "--target", nargs="+", help="Target host(s)/IP(s) — a DC or member host")
    p.add_argument("-u", "--username", help="Username for authentication")
    p.add_argument("-p", "--password", help="Password for authentication")
    p.add_argument("-H", "--ntlm-hash", dest="ntlm_hash", help="NT hash for pass-the-hash")
    p.add_argument("-w", "--wordlist", help="Password list for the cracking phase")
    p.add_argument("--tools", help="Comma-separated tool list (default: all)")
    p.add_argument("--output-dir", default="./output", help="Output directory")
    p.add_argument("--data-dir", default="./data", help="Data directory")
    p.add_argument("--list-tools", action="store_true", help="List available AD tools and exit")
    return p


def _print_tools() -> None:
    print("PhantomGrid AD tools:")
    for t in list_tools():
        from tools.registry import get_tool
        avail = get_tool(t["name"], Path("."), Path(".")).availability_error()  # type: ignore[union-attr]
        mark = "✗ " + avail if avail else "✓ available"
        print(f"  {t['name']:18} [{t['category']:9}] {mark}")


async def _run(args: argparse.Namespace) -> int:
    tools = [s.strip() for s in args.tools.split(",")] if args.tools else list(DEFAULT_AD_TOOLS)
    output_dir, data_dir = Path(args.output_dir), Path(args.data_dir)
    storage = DualStorage(str(output_dir))

    project = Project(name=f"CLI-{args.domain or args.target[0]}", description="CLI AD scan")
    await storage.save_project(project)
    scan = Scan(project_id=project.id, tools=tools, ad_domain=args.domain or "", username=args.username or "")
    await storage.save_scan(scan)

    credentials = {
        "ad_domain": args.domain or "",
        "username": args.username or "",
        "password": args.password or "",
        "ntlm_hash": args.ntlm_hash or "",
    }

    # Tail the progress queue and print a live line per event.
    q = scan_engine.get_progress_queue(scan.id)

    async def printer() -> None:
        while True:
            ev = await q.get()
            tool, status, phase = ev["tool"], ev["status"], ev.get("phase", "")
            if tool == "__phase__" and status == "running":
                print(f"\n=== {ev['message']} ===")
            elif tool == "__scan__" and status in ("completed", "failed", "cancelled"):
                print(f"\n[scan {status}]")
                return
            elif not tool.startswith("__") and tool != "handoff":
                icon = {"running": "·", "done": "+", "error": "!", "skipped": "-"}.get(status, " ")
                msg = f" — {ev['message']}" if ev.get("message") else ""
                print(f"  [{icon}] {tool} ({status}){msg}")

    runner = asyncio.create_task(
        scan_engine.run_scan(scan, args.target, credentials, output_dir, data_dir, storage, args.wordlist)
    )
    await printer()
    runner.cancel()  # results are already persisted; skip the engine's queue-drain sleep

    print(f"\nResults saved under {output_dir.resolve()}/<target>/  (status: {scan.status.value})")
    return 0 if scan.status == ScanStatus.COMPLETED else 1


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.list_tools:
        _print_tools()
        return 0
    if not args.target:
        print("error: at least one --target is required (or use --list-tools)", file=sys.stderr)
        return 2
    if not args.username or (not args.password and not args.ntlm_hash):
        print("error: --username and (--password or --ntlm-hash) are required", file=sys.stderr)
        return 2
    return asyncio.run(_run(args))


if __name__ == "__main__":
    raise SystemExit(main())
