"""Serialize the headless run with the Mini's conformance and performance jobs."""
import fcntl
import os
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
lock_path = root / "artifacts/conformance/campaign/gpu.lock"
lock_path.parent.mkdir(parents=True, exist_ok=True)
with lock_path.open("a+") as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    env = dict(os.environ, REFRAL_TEST="1", REFRAL_BENCHMARK="1")
    raise SystemExit(subprocess.call(["node", "tools/external-benchmarks.mjs"], cwd=root, env=env))
