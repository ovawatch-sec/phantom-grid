"""
process_registry.py — track live subprocesses per scan so a scan can be cancelled.

The scan engine launches tool binaries via asyncio subprocesses. Setting a scan to
CANCELLED only stops *new* phases from starting; any tool already mid-flight would
keep running (and holding network/CPU) until its own timeout. This registry lets the
cancel endpoint terminate those in-flight processes immediately.

The registry is process-local (single backend process), which matches PhantomGrid's
single-container deployment model.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging

logger = logging.getLogger(__name__)

# scan_id → set of live subprocess handles
_procs: dict[str, set[asyncio.subprocess.Process]] = {}

# Grace period between SIGTERM and SIGKILL when terminating a scan.
_TERMINATE_GRACE_SECONDS = 3


def register(scan_id: str, proc: asyncio.subprocess.Process) -> None:
    """Track a freshly-spawned subprocess against its scan."""
    if not scan_id:
        return
    _procs.setdefault(scan_id, set()).add(proc)


def unregister(scan_id: str, proc: asyncio.subprocess.Process) -> None:
    """Stop tracking a subprocess once it has terminated."""
    if not scan_id:
        return
    bucket = _procs.get(scan_id)
    if bucket is not None:
        bucket.discard(proc)
        if not bucket:
            _procs.pop(scan_id, None)


async def terminate_scan(scan_id: str) -> int:
    """Terminate all live subprocesses for a scan. Returns the count signalled."""
    procs = list(_procs.get(scan_id, set()))
    signalled = 0

    for proc in procs:
        if proc.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                proc.terminate()
                signalled += 1

    if signalled:
        await asyncio.sleep(_TERMINATE_GRACE_SECONDS)
        for proc in procs:
            if proc.returncode is None:
                with contextlib.suppress(ProcessLookupError):
                    proc.kill()

    _procs.pop(scan_id, None)
    if signalled:
        logger.info("Terminated %d process(es) for scan %s", signalled, scan_id)
    return signalled
