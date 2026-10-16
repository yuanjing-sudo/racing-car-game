import pickle
import sys
from pathlib import Path
from datetime import datetime

from config import DATA_DIR, MODEL_PATH, LOGS_DIR


def _extract_features_sigma(sigma_dir: Path) -> list[dict]:
    import yaml
    features = []
    for rule_file in sigma_dir.rglob("*.yml"):
        try:
            with open(rule_file, "r", encoding="utf-8", errors="replace") as f:
                rule = yaml.safe_load(f)
            if isinstance(rule, dict):
                features.append({
                    "source": "sigma",
                    "title": rule.get("title", ""),
                    "description": rule.get("description", ""),
                    "level": rule.get("level", "unknown"),
                    "tags": rule.get("tags", []),
                    "logsource": rule.get("logsource", {}),
                    "detection": rule.get("detection", {}),
                })
        except Exception:
            continue
    return features


def _extract_features_snort(snort_dir: Path) -> list[dict]:
    features = []
    for rule_file in snort_dir.rglob("*.rules"):
        try:
            with open(rule_file, "r", encoding="utf-8", errors="replace") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#"):
                        features.append({"source": "snort", "rule": line})
        except Exception:
            continue
    return features


def _extract_features_proxy(proxy_file: Path) -> list[dict]:
    features = []
    if not proxy_file.exists():
        return features
    for line in proxy_file.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            features.append({"source": "proxy", "ip": line})
    return features


def _extract_features_fingerprints(fp_file: Path) -> list[dict]:
    import csv
    features = []
    if not fp_file.exists():
        return features
    try:
        with open(fp_file, "r", encoding="utf-8", errors="replace") as f:
            reader = csv.DictReader(f)
            for i, row in enumerate(reader):
                if i >= 10000:
                    break
                features.append({"source": "fingerprint", **row})
    except Exception:
        pass
    return features


def _extract_features_keystrokes(ks_dir: Path) -> list[dict]:
    features = []
    if not ks_dir.exists():
        return features
    for data_file in ks_dir.iterdir():
        if data_file.suffix in (".csv", ".txt", ".dat"):
            try:
                lines = data_file.read_text(encoding="utf-8", errors="replace").splitlines()
                for line in lines[:1000]:
                    features.append({"source": "keystroke", "file": data_file.name, "data": line})
            except Exception:
                continue
    return features


def retrain_model() -> bool:
    try:
        from sklearn.ensemble import RandomForestClassifier
        from sklearn.model_selection import train_test_split
        from sklearn.metrics import classification_report
        import numpy as np
    except ImportError:
        print("[train] scikit-learn not installed. Run: pip install scikit-learn", file=sys.stderr)
        return False

    print("[train] Extracting features from all data sources...")
    features = []
    features.extend(_extract_features_sigma(DATA_DIR / "sigma"))
    features.extend(_extract_features_snort(DATA_DIR / "suricata"))
    features.extend(_extract_features_proxy(DATA_DIR / "proxy_blacklist.txt"))
    features.extend(_extract_features_fingerprints(DATA_DIR / "fingerprints.csv"))
    features.extend(_extract_features_keystrokes(DATA_DIR / "keystrokes"))

    if not features:
        print("[train] No features extracted. Check data sources.", file=sys.stderr)
        return False

    print(f"[train] Total features: {len(features)}")

    X = np.array([len(str(f)) for f in features]).reshape(-1, 1)
    y = np.array([1 if f.get("source") in ("sigma", "snort") else 0 for f in features])

    if len(set(y)) < 2:
        print("[train] Need both positive and negative samples.", file=sys.stderr)
        return False

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    clf = RandomForestClassifier(n_estimators=100, random_state=42, n_jobs=-1)
    clf.fit(X_train, y_train)

    y_pred = clf.predict(X_test)
    report = classification_report(y_test, y_pred, output_dict=True)

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(MODEL_PATH, "wb") as f:
        pickle.dump(clf, f)

    log_file = LOGS_DIR / f"training_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
    with open(log_file, "w") as f:
        f.write(f"Training run: {datetime.now().isoformat()}\n")
        f.write(f"Samples: {len(features)}\n")
        f.write(f"Accuracy: {report['accuracy']:.4f}\n")
        f.write(f"Model saved: {MODEL_PATH}\n")

    print(f"[train] Accuracy: {report['accuracy']:.4f}")
    print(f"[train] Model saved: {MODEL_PATH}")
    print(f"[train] Log: {log_file}")
    return True
