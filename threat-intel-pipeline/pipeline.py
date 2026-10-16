#!/usr/bin/env python3
"""Daily Threat Intelligence Training Pipeline

Downloads public threat intel, retrains detection model, deploys to jump box.
"""
import argparse
import sys
import time
from datetime import datetime

from config import LOGS_DIR
from downloaders import download_sigma, download_snort, download_proxy_list, download_fingerprints, download_keystrokes
from training import retrain_model
from deploy import deploy_model


STEPS = [
    ("Sigma Rules", download_sigma),
    ("Snort/Suricata Rules", download_snort),
    ("Proxy Blacklist", download_proxy_list),
    ("Browser Fingerprints", download_fingerprints),
    ("Keystroke Data", download_keystrokes),
    ("Retrain Model", retrain_model),
    ("Deploy Model", deploy_model),
]


def run_pipeline(steps: list[str] | None = None, skip_deploy: bool = False) -> int:
    LOGS_DIR.mkdir(exist_ok=True)
    start = time.time()
    print(f"=== Pipeline started {datetime.now().isoformat()} ===")

    results = {}
    for name, func in STEPS:
        if steps and name not in steps:
            continue
        if skip_deploy and name == "Deploy Model":
            continue

        print(f"\n--- Step: {name} ---")
        try:
            ok = func()
        except Exception as e:
            print(f"[pipeline] Step '{name}' crashed: {e}", file=sys.stderr)
            ok = False
        results[name] = ok

    elapsed = time.time() - start
    print(f"\n=== Pipeline finished in {elapsed:.1f}s ===")
    for name, ok in results.items():
        status = "PASS" if ok else "FAIL"
        print(f"  [{status}] {name}")

    return 0 if all(results.values()) else 1


def main():
    parser = argparse.ArgumentParser(description="Daily threat intel training pipeline")
    parser.add_argument("--steps", nargs="*", help="Run only these steps")
    parser.add_argument("--skip-deploy", action="store_true", help="Skip deployment")
    args = parser.parse_args()
    sys.exit(run_pipeline(args.steps, args.skip_deploy))


if __name__ == "__main__":
    main()
