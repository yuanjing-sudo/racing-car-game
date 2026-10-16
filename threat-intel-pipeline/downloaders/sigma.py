import subprocess
import sys
from pathlib import Path
from config import SIGMA_REPO, SIGMA_DIR


def download_sigma() -> bool:
    try:
        if SIGMA_DIR.exists():
            print(f"[sigma] Updating existing repo at {SIGMA_DIR}")
            result = subprocess.run(
                ["git", "pull"],
                cwd=str(SIGMA_DIR),
                capture_output=True,
                text=True,
                timeout=300,
            )
        else:
            print(f"[sigma] Cloning {SIGMA_REPO} -> {SIGMA_DIR}")
            SIGMA_DIR.parent.mkdir(parents=True, exist_ok=True)
            result = subprocess.run(
                ["git", "clone", "--depth", "1", SIGMA_REPO, str(SIGMA_DIR)],
                capture_output=True,
                text=True,
                timeout=300,
            )
        if result.returncode != 0:
            print(f"[sigma] ERROR: {result.stderr}", file=sys.stderr)
            return False
        print("[sigma] OK")
        return True
    except Exception as e:
        print(f"[sigma] EXCEPTION: {e}", file=sys.stderr)
        return False
