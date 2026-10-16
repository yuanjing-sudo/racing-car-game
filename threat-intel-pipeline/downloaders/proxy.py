import sys
import urllib.request
from config import PROXY_LIST_URL, PROXY_FILE


def download_proxy_list() -> bool:
    try:
        print(f"[proxy] Downloading {PROXY_LIST_URL}")
        urllib.request.urlretrieve(PROXY_LIST_URL, str(PROXY_FILE))
        lines = PROXY_FILE.read_text(encoding="utf-8", errors="replace").count("\n")
        print(f"[proxy] OK ({lines} entries)")
        return True
    except Exception as e:
        print(f"[proxy] EXCEPTION: {e}", file=sys.stderr)
        return False
