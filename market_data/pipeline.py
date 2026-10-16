#!/usr/bin/env python3
"""Institutional Grade Market Data Pipeline with AI/ML

Handles downloading, processing, and AI-powered prediction of market data
across multiple asset classes with sophisticated risk management.
"""
import argparse
import sys
import time
from datetime import datetime

from config import DATA_DIR, LOGS_DIR, AI_CONFIG, RISK_CONFIG, ASSET_CLASSES
from downloaders import (
    download_forex_data,
    download_crypto_data,
    download_stock_data,
    download_index_data,
    download_commodity_data,
    download_etf_data,
    download_alternative_data,
)
from training import train_ai_model, retrain_models, train_alternative_model, retrain_alternative_model
from deploy import deploy_model, predict_signal, predict_alternative_signal


STAGES = [
    ("Forex Data Download", download_forex_data),
    ("Crypto Data Download", download_crypto_data),
    ("Stocks Data Download", download_stock_data),
    ("Indices Data Download", download_index_data),
    ("Commodities Data Download", download_commodity_data),
    ("ETFs Data Download", download_etf_data),
    ("Alternative Data Download", download_alternative_data),
    ("AI Model Training", train_ai_model),
    ("Alternative Model Training", train_alternative_model),
    ("Model Retraining", retrain_models),
    ("Alternative Model Retraining", retrain_alternative_model),
    ("Model Deployment", deploy_model),
    ("Alternative Signal Prediction", predict_alternative_signal),
    ("Signal Prediction", predict_signal),
]


def _get_asset_classes_for_stage(name: str, asset_classes: list[str] | None) -> list[str]:
    """Get the appropriate asset classes for a given pipeline stage."""
    if name == "Alternative Data Download":
        return ["alternative"] if "alternative" in (asset_classes or []) else ["alternative"]
    if name in ("Alternative Model Training", "Alternative Model Retraining", "Alternative Signal Prediction"):
        return ["alternative"] if "alternative" in (asset_classes or []) else ["alternative"]
    return asset_classes or ["forex", "crypto", "stocks", "indices", "commodities", "etfs"]


def download_alternative_data(asset_classes: list[str] | None = None,
                              retrain: bool = True) -> bool:
    """Download Alternative market data from institutional sources."""
    if asset_classes is None:
        asset_classes = ["alternative"] if "alternative" in (asset_classes or []) else ["alternative"]

    success = True
    data_types = [
        "sentiment", "news", "satellite", "social",
        "credit", "employment", "real_estate", "commodity_inventory"
    ]

    for asset_class in asset_classes:
        if asset_class != "alternative":
            continue
            
        print(f"  Downloading Alternative data for {len(data_types)} data types...")

        for data_type in data_types:
            try:
                # Create alternative data directory
                alt_dir = DATA_DIR / "alternative"
                alt_dir.mkdir(exist_ok=True)

                # Download data for each frequency
                for freq in FREQUENCIES:
                    data_file = alt_dir / f"{data_type}_{freq}.csv"

                    # Generate institutional alternative data directly
                    from downloaders.alternative import (
                        _generate_sentiment_data, _generate_news_data,
                        _generate_satellite_data, _generate_social_data,
                        _generate_credit_data, _generate_employment_data,
                        _generate_real_estate_data, _generate_commodity_inventory_data
                    )
                    
                    func_map = {
                        "sentiment": _generate_sentiment_data,
                        "news": _generate_news_data,
                        "satellite": _generate_satellite_data,
                        "social": _generate_social_data,
                        "credit": _generate_credit_data,
                        "employment": _generate_employment_data,
                        "real_estate": _generate_real_estate_data,
                        "commodity_inventory": _generate_commodity_inventory_data,
                    }
                    
                    if data_type in func_map:
                        # Use a dummy date since we're generating synthetic data
                        import datetime
                        dummy_date = datetime.date(2024, 1, 1)
                        func_map[data_type]([dummy_date.isoformat()], freq, data_file)

                    print(f"    ✓ {data_type} {freq} data ready")

            except Exception as e:
                print(f"    ✗ {data_type} failed: {e}")
                import traceback
                traceback.print_exc()
                success = False

    return success


def run_pipeline(stages: list[str] | None = None, 
                 asset_classes: list[str] | None = None,
                 retrain: bool = True) -> int:
    """Run the market data pipeline with optional filtering."""
    LOGS_DIR.mkdir(exist_ok=True)
    start = time.time()
    print(f"=== Institutional Market Data Pipeline Started {datetime.now().isoformat()} ===")
    print(f"Asset classes: {asset_classes or ASSET_CLASSES}")
    print(f"AI Config: {AI_CONFIG['model_type']} lookback={AI_CONFIG['lookback_periods']}s")
    print(f"Risk Mgmt: max_pos={RISK_CONFIG['max_position_size']*100}%, "
          f"max_loss={RISK_CONFIG['max_daily_loss']*100}%")

    effective_asset_classes = _get_asset_classes_for_stage(
        "", asset_classes
    )
    
    results = {}
    for name, func in STAGES:
        if stages and name not in stages:
            continue
        
        print(f"\n--- Stage: {name} ---")
        try:
            stage_asset_classes = _get_asset_classes_for_stage(name, asset_classes)
            ok = func(asset_classes=stage_asset_classes, retrain=retrain)
        except Exception as e:
            print(f"[pipeline] Stage '{name}' crashed: {e}", file=sys.stderr)
            ok = False
        results[name] = ok

    elapsed = time.time() - start
    print(f"\n=== Pipeline finished in {elapsed:.1f}s ===")
    for name, ok in results.items():
        status = "PASS" if ok else "FAIL"
        print(f"  [{status}] {name}")

    return 0 if all(results.values()) else 1


def main():
    parser = argparse.ArgumentParser(
        description="Institutional grade market data pipeline with AI/ML"
    )
    parser.add_argument("--stages", nargs="*", 
                        help="Run only these specific stages")
    parser.add_argument("--asset-classes", nargs="+",
                        choices=["forex", "crypto", "stocks", "indices", "commodities", "etfs", "alternative"],
                        default=["forex", "crypto", "stocks", "alternative"],
                        help="Asset classes to process")
    parser.add_argument("--retrain", action="store_true",
                        help="Force retrain all AI models")
    parser.add_argument("--no-retrain", action="store_true",
                        help="Skip retraining (use existing models)")
    args = parser.parse_args()
    
    retrain = args.retrain and not args.no_retrain
    sys.exit(run_pipeline(args.stages, args.asset_classes, retrain))


if __name__ == "__main__":
    main()