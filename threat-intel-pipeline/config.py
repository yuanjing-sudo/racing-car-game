import os
from pathlib import Path

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
LOGS_DIR = BASE_DIR / "logs"
MODEL_PATH = BASE_DIR / "model.pkl"

DATA_DIR.mkdir(exist_ok=True)
LOGS_DIR.mkdir(exist_ok=True)

SIGMA_REPO = "https://github.com/SigmaHQ/sigma"
SIGMA_DIR = DATA_DIR / "sigma"

SNORT_RULES_URL = "https://rules.emergingthreats.net/open/suricata-6.0.8/emerging.rules.tar.gz"
SNORT_DIR = DATA_DIR / "suricata"

PROXY_LIST_URL = "https://raw.githubusercontent.com/X4BNet/lists_vpn/main/ipv4.txt"
PROXY_FILE = DATA_DIR / "proxy_blacklist.txt"

FINGERPRINT_URL = "https://amiunique.org/data/amiunique_latest.csv"
FINGERPRINT_FILE = DATA_DIR / "fingerprints.csv"

KEYSTROKE_URL = "https://www.cs.cmu.edu/~keystroke/data/"
KEYSTROKE_DIR = DATA_DIR / "keystrokes"

JUMP_BOX_HOST = os.environ.get("JUMP_BOX_HOST", "your-jump-box")
JUMP_BOX_USER = os.environ.get("JUMP_BOX_USER", "root")
JUMP_BOX_PATH = os.environ.get("JUMP_BOX_PATH", "/opt/omni_ai/")
SSH_KEY = os.environ.get("SSH_KEY", str(Path.home() / ".ssh" / "id_rsa"))
