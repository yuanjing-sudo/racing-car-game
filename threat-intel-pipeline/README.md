# Threat Intelligence Training Pipeline

Daily pipeline that scrapes public threat intel, retrains a detection model, and deploys it.

## Quick Start

```bash
pip install -r requirements.txt
python pipeline.py
```

## Configuration

Set environment variables for deployment:

| Variable | Default | Description |
|----------|---------|-------------|
| `JUMP_BOX_HOST` | `your-jump-box` | Target server hostname/IP |
| `JUMP_BOX_USER` | `root` | SSH username |
| `JUMP_BOX_PATH` | `/opt/omni_ai/` | Remote deploy path |
| `SSH_KEY` | `~/.ssh/id_rsa` | SSH private key path |

## Usage

```bash
# Full pipeline
python pipeline.py

# Only download steps (no train/deploy)
python pipeline.py --steps "Sigma Rules" "Snort/Suricata Rules" "Proxy Blacklist"

# Train but skip deploy
python pipeline.py --skip-deploy

# Only retrain + deploy
python pipeline.py --steps "Retrain Model" "Deploy Model"
```

## Data Sources

- [SigmaHQ/sigma](https://github.com/SigmaHQ/sigma) - Detection patterns
- [Emerging Threats](https://rules.emergingthreats.net/) - Snort/Suricata rules
- [X4BNet/lists_vpn](https://github.com/X4BNet/lists_vpn) - Proxy/VPN IPs
- [AmIUnique](https://amiunique.org/) - Browser fingerprinting dataset
- [CMU Keystroke Dynamics](https://www.cs.cmu.edu/~keystroke/) - Behavioral biometrics

## Output

- `model.pkl` - Trained Random Forest classifier
- `logs/training_*.log` - Training metrics per run
- `data/` - Downloaded datasets
