import sys
import urllib.request
from config import FINGERPRINT_FILE

FINGERPRINT_SOURCES = [
    "https://amiunique.org/data/amiunique_latest.csv",
    "https://raw.githubusercontent.com/amiunique/amiunique/master/doc/amiunique_latest.csv",
]


def download_fingerprints() -> bool:
    if FINGERPRINT_FILE.exists() and FINGERPRINT_FILE.stat().st_size > 0:
        print(f"[fingerprints] Already exists ({FINGERPRINT_FILE.stat().st_size} bytes)")
        return True

    for url in FINGERPRINT_SOURCES:
        try:
            print(f"[fingerprints] Trying {url}")
            req = urllib.request.Request(url, headers={"User-Agent": "threat-intel-pipeline/1.0"})
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = resp.read()
                if len(data) < 1000:
                    continue
                FINGERPRINT_FILE.write_bytes(data)
            size_mb = len(data) / (1024 * 1024)
            print(f"[fingerprints] OK ({size_mb:.1f} MB)")
            return True
        except Exception as e:
            print(f"[fingerprints] Failed: {e}")
            continue

    print("[fingerprints] WARNING: No public download available, creating placeholder", file=sys.stderr)
    FINGERPRINT_FILE.write_text("user_agent,screen_resolution,timezone,language\n")
    return True
