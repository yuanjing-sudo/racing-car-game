import subprocess
import sys
from pathlib import Path
from config import MODEL_PATH, JUMP_BOX_HOST, JUMP_BOX_USER, JUMP_BOX_PATH, SSH_KEY


def deploy_model() -> bool:
    if not MODEL_PATH.exists():
        print(f"[deploy] Model not found: {MODEL_PATH}", file=sys.stderr)
        return False

    if JUMP_BOX_HOST == "your-jump-box":
        print("[deploy] JUMP_BOX_HOST not configured. Set env var JUMP_BOX_HOST.", file=sys.stderr)
        return False

    try:
        import paramiko
    except ImportError:
        print("[deploy] paramiko not installed. Run: pip install paramiko", file=sys.stderr)
        return False

    try:
        print(f"[deploy] Connecting to {JUMP_BOX_USER}@{JUMP_BOX_HOST}")
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        ssh.connect(
            hostname=JUMP_BOX_HOST,
            username=JUMP_BOX_USER,
            key_filename=SSH_KEY if Path(SSH_KEY).exists() else None,
            timeout=30,
        )

        sftp = ssh.open_sftp()
        try:
            sftp.mkdir(JUMP_BOX_PATH)
        except IOError:
            pass

        remote_path = JUMP_BOX_PATH.rstrip("/") + "/" + MODEL_PATH.name
        print(f"[deploy] Uploading {MODEL_PATH} -> {remote_path}")
        sftp.put(str(MODEL_PATH), remote_path)

        stdin, stdout, stderr = ssh.exec_command(f"ls -la {remote_path}")
        print(stdout.read().decode())

        sftp.close()
        ssh.close()
        print("[deploy] OK")
        return True
    except Exception as e:
        print(f"[deploy] EXCEPTION: {e}", file=sys.stderr)
        return False
