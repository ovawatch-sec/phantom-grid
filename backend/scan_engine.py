"""
scan_engine.py — phased Active Directory scan orchestration for PhantomGrid.

Design (mirrors the ShadowGrid recon engine):
  - A phase does not start until the previous phase has fully drained.
  - Each phase runs its selected tools in parallel.
  - Phase hand-off artifacts (users.txt, *_hashes.txt) are written before the
    dependent phase starts.
  - Progress is emitted over SSE and persisted on the Scan so reconnects replay.

Credentials are passed in memory only and are never persisted or logged.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from pathlib import Path

from models import Scan, ScanProgress, ScanStatus, ToolResult
from storage import DualStorage
from tools.registry import get_tool

logger = logging.getLogger(__name__)

# scan_id → asyncio.Queue of SSE event dicts
_progress_queues: dict[str, asyncio.Queue] = {}

PHASES: list[dict[str, object]] = [
    {"index": 1, "name": "Host Discovery", "tools": ["host_discovery"]},
    {"index": 2, "name": "User & Group Enumeration", "tools": ["lookupsid"]},
    {"index": 3, "name": "Kerberos Attacks", "tools": ["asrep_roast", "kerberoast"]},
    {"index": 4, "name": "Shares & Services", "tools": ["smb_shares", "winrm_check", "ldap_dump"]},
    {"index": 5, "name": "Graph Collection", "tools": ["bloodhound"]},
    {"index": 6, "name": "Credential Cracking", "tools": ["crack_asrep", "crack_kerberoast"]},
]


def get_progress_queue(scan_id: str) -> asyncio.Queue:
    if scan_id not in _progress_queues:
        _progress_queues[scan_id] = asyncio.Queue(maxsize=1000)
    return _progress_queues[scan_id]


def drop_progress_queue(scan_id: str) -> None:
    _progress_queues.pop(scan_id, None)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _selected_tools(scan: Scan, phase: dict) -> list[str]:
    requested = set(scan.tools or [])
    return [t for t in phase["tools"] if t in requested]  # type: ignore[index]


async def _emit(scan: Scan, storage: DualStorage, tool: str, status: str, message: str = "",
                count: int = 0, *, domain: str = "", phase: str = "", phase_index: int = 0,
                completed_tools: int = 0, total_tools: int = 0,
                overall_completed_tools: int = 0, overall_total_tools: int = 0,
                persist: bool = True) -> None:
    """Emit one progress event to SSE and persist it on the Scan record."""
    event = {
        "tool": tool, "status": status, "message": message, "count": count,
        "ts": _now_iso(), "domain": domain, "phase": phase, "phase_index": phase_index,
        "phase_total": len(PHASES), "completed_tools": completed_tools, "total_tools": total_tools,
        "overall_completed_tools": overall_completed_tools, "overall_total_tools": overall_total_tools,
    }
    q = get_progress_queue(scan.id)
    try:
        q.put_nowait(event)
    except asyncio.QueueFull:
        try:
            _ = q.get_nowait()
            q.put_nowait(event)
        except Exception:
            pass

    if persist:
        try:
            scan.progress.append(ScanProgress(**event))
            if len(scan.progress) > 1000:
                scan.progress = scan.progress[-1000:]
            await storage.save_scan(scan)
        except Exception:
            logger.exception("Could not persist progress event")

    logger.info("[%s] %s: %s — %s", scan.id, tool, status, message)


async def _scan_cancelled(scan: Scan, storage: DualStorage) -> bool:
    latest = await storage.get_scan(scan.id)
    return bool(latest and latest.status == ScanStatus.CANCELLED)


def _write_lines(path: Path, lines: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    content = "\n".join(dict.fromkeys(l for l in lines if l))  # de-dupe, keep order
    path.write_text(content + ("\n" if content else ""))


def _write_handoff_after_phase(idx: int, target_dir: Path,
                               results_by_tool: dict[str, ToolResult | None]) -> list[tuple[str, int]]:
    """Write the files a later phase depends on. Returns (filename, count) notes to emit."""
    notes: list[tuple[str, int]] = []

    if idx == 2:  # users.txt feeds AS-REP roasting in phase 3
        lookup = results_by_tool.get("lookupsid")
        users = [r.get("name", "") for r in (lookup.data if lookup else []) if r.get("type") == "user"]
        _write_lines(target_dir / "users.txt", users)
        notes.append(("users.txt", len(users)))

    elif idx == 3:  # hash files feed the cracking phase
        asrep = results_by_tool.get("asrep_roast")
        tgs = results_by_tool.get("kerberoast")
        asrep_hashes = [r.get("hash", "") for r in (asrep.data if asrep else [])]
        tgs_hashes = [r.get("hash", "") for r in (tgs.data if tgs else [])]
        _write_lines(target_dir / "asrep_hashes.txt", asrep_hashes)
        _write_lines(target_dir / "kerberoast_hashes.txt", tgs_hashes)
        notes.append(("asrep_hashes.txt", len(asrep_hashes)))
        notes.append(("kerberoast_hashes.txt", len(tgs_hashes)))

    return notes


async def _run_tool(tool_name: str, target: str, scan: Scan, credentials: dict,
                    output_dir: Path, data_dir: Path, storage: DualStorage, wordlist: str | None,
                    *, phase: str, phase_index: int, completed_ref: dict, total_tools: int,
                    overall_ref: dict, overall_total: int) -> ToolResult | None:
    tool = get_tool(tool_name, output_dir, data_dir)

    def _bump():
        completed_ref["value"] += 1
        overall_ref["value"] += 1

    common = dict(domain=target, phase=phase, phase_index=phase_index, total_tools=total_tools,
                  overall_total_tools=overall_total)

    if tool is None:
        _bump()
        await _emit(scan, storage, tool_name, "skipped", "Not registered", **common,
                    completed_tools=completed_ref["value"], overall_completed_tools=overall_ref["value"])
        return None

    availability_error = tool.availability_error()
    if availability_error:
        _bump()
        await _emit(scan, storage, tool_name, "skipped", availability_error, **common,
                    completed_tools=completed_ref["value"], overall_completed_tools=overall_ref["value"])
        return None

    await _emit(scan, storage, tool_name, "running", **common,
                completed_tools=completed_ref["value"], overall_completed_tools=overall_ref["value"])

    try:
        result = await tool.execute(target, scan.id, scan.project_id, oos=[], wordlist=wordlist, extra=credentials)
        await storage.save_result(result)
        _bump()
        status, msg = ("error", result.error[:500]) if result.error else ("done", f"{result.count} results")
        await _emit(scan, storage, tool_name, status, msg, result.count, **common,
                    completed_tools=completed_ref["value"], overall_completed_tools=overall_ref["value"])
        return result
    except Exception as exc:  # noqa: BLE001 — surface a tool crash as a tool error, never kill the scan
        logger.exception("%s raised", tool_name)
        _bump()
        await _emit(scan, storage, tool_name, "error", str(exc)[:500], **common,
                    completed_tools=completed_ref["value"], overall_completed_tools=overall_ref["value"])
        return None


async def run_scan(scan: Scan, targets: list[str], credentials: dict, output_dir: Path,
                   data_dir: Path, storage: DualStorage, wordlist: str | None = None) -> None:
    """Main AD scan coroutine — called by the API background task or CLI.

    `credentials` is a dict with ad_domain/username/password/ntlm_hash and is held
    in memory only for the duration of the run.
    """
    scan.status = ScanStatus.RUNNING
    scan.started_at = datetime.now(timezone.utc)
    scan.completed_at = None
    scan.error = ""
    await storage.save_scan(scan)

    overall_total = sum(len(_selected_tools(scan, p)) for p in PHASES) * len(targets)
    overall_ref = {"value": 0}

    try:
        for target in targets:
            if await _scan_cancelled(scan, storage):
                scan.status = ScanStatus.CANCELLED
                break

            await _emit(scan, storage, "__domain__", "start", target, domain=target,
                        overall_completed_tools=overall_ref["value"], overall_total_tools=overall_total)
            target_dir = output_dir / target

            for phase in PHASES:
                if await _scan_cancelled(scan, storage):
                    scan.status = ScanStatus.CANCELLED
                    await _emit(scan, storage, "__scan__", "cancelled", "Scan cancelled", domain=target)
                    break

                idx = int(phase["index"])
                name = str(phase["name"])
                tools = _selected_tools(scan, phase)
                label = f"Phase {idx}: {name}"

                if not tools:
                    await _emit(scan, storage, "__phase__", "skipped", f"{label} — no selected tools",
                                domain=target, phase=name, phase_index=idx,
                                overall_completed_tools=overall_ref["value"], overall_total_tools=overall_total)
                    continue

                await _emit(scan, storage, "__phase__", "running", label, domain=target, phase=name,
                            phase_index=idx, total_tools=len(tools),
                            overall_completed_tools=overall_ref["value"], overall_total_tools=overall_total)

                completed_ref = {"value": 0}
                results = await asyncio.gather(*[
                    _run_tool(t, target, scan, credentials, output_dir, data_dir, storage, wordlist,
                              phase=name, phase_index=idx, completed_ref=completed_ref, total_tools=len(tools),
                              overall_ref=overall_ref, overall_total=overall_total)
                    for t in tools
                ])
                results_by_tool = dict(zip(tools, results))

                for fname, fcount in _write_handoff_after_phase(idx, target_dir, results_by_tool):
                    await _emit(scan, storage, "handoff", "done", f"Wrote {fname}", fcount,
                                domain=target, phase=name, phase_index=idx,
                                overall_completed_tools=overall_ref["value"], overall_total_tools=overall_total)

                await _emit(scan, storage, "__phase__", "done", f"{label} complete", domain=target,
                            phase=name, phase_index=idx, completed_tools=len(tools), total_tools=len(tools),
                            overall_completed_tools=overall_ref["value"], overall_total_tools=overall_total)

            if scan.status == ScanStatus.CANCELLED:
                break

            await _emit(scan, storage, "__domain__", "done", target, domain=target,
                        overall_completed_tools=overall_ref["value"], overall_total_tools=overall_total)

        if scan.status != ScanStatus.CANCELLED:
            scan.status = ScanStatus.COMPLETED

    except Exception as exc:  # noqa: BLE001
        logger.exception("Scan failed")
        scan.status = ScanStatus.FAILED
        scan.error = str(exc)

    scan.completed_at = datetime.now(timezone.utc)
    await storage.save_scan(scan)
    await _emit(scan, storage, "__scan__", scan.status.value, scan.status.value,
                overall_completed_tools=overall_ref["value"], overall_total_tools=overall_total)

    # Leave the queue open briefly so the frontend can drain the final events.
    await asyncio.sleep(60)
    drop_progress_queue(scan.id)
