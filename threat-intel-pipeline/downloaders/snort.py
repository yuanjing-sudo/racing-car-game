import subprocess
import sys
import tarfile
import urllib.request
from pathlib import Path
from config import SNORT_RULES_URL, SNORT_DIR


def download_snort() -> bool:
    try:
        SNORT_DIR.mkdir(parents=True, exist_ok=True)
        tar_path = SNORT_DIR / "emerging.rules.tar.gz"

        print(f"[snort] Downloading {SNORT_RULES_URL}")
        urllib.request.urlretrieve(SNORT_RULES_URL, str(tar_path))

        print(f"[snort] Extracting to {SNORT_DIR}")
        with tarfile.open(str(tar_path), "r:gz") as tar:
            tar.extractall(path=str(SNORT_DIR))

        tar_path.unlink()
        print("[snort] OK")
        return True
    except Exception as e:
        print(f"[snort] EXCEPTION: {e}", file=sys.stderr)
        return False
