import sys
import urllib.request
from pathlib import Path
from config import KEYSTROKE_DIR

KEYSTROKE_FILES = [
    "https://www.cs.cmu.edu/~keystroke/DSL-StrongPasswordData.csv",
    "https://www.cs.cmu.edu/~keystroke/DSL-StrongPasswordData.txt",
]


def download_keystrokes() -> bool:
    try:
        KEYSTROKE_DIR.mkdir(parents=True, exist_ok=True)
        downloaded = 0
        for url in KEYSTROKE_FILES:
            filename = url.rsplit("/", 1)[-1]
            dest = KEYSTROKE_DIR / filename
            if dest.exists():
                print(f"[keystrokes] {filename} already exists, skipping")
                downloaded += 1
                continue
            print(f"[keystrokes] Downloading {filename}")
            req = urllib.request.Request(url, headers={"User-Agent": "threat-intel-pipeline/1.0"})
            with urllib.request.urlopen(req, timeout=120) as resp:
                dest.write_bytes(resp.read())
            downloaded += 1

        if downloaded == 0:
            print("[keystrokes] No files downloaded", file=sys.stderr)
            return False
        print(f"[keystrokes] OK ({downloaded} files)")
        return True
    except Exception as e:
        print(f"[keystrokes] EXCEPTION: {e}", file=sys.stderr)
        return False
