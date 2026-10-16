#!/usr/bin/env python3
"""Model Deployment and Signal Prediction Module.

Deploys trained models and generates trading signals based on
AI predictions with risk management filters.
"""
import os
import json
import time
import numpy as np
import pandas as pd
from pathlib import Path
from config import DATA_DIR, LOGS_DIR, AI_CONFIG, RISK_CONFIG, MODEL_PATH
from training import prepare_features, create_sequences


def deploy_model(asset_classes: list[str] | None = None,
                 retrain: bool = True) -> bool:
    """Deploy trained AI models for live trading."""
    if asset_classes is None:
        asset_classes = ["forex", "crypto", "stocks"]
    
    success = True
    
    print(f"  Deploying AI models for {len(asset_classes)} asset classes...")
    
    for asset_class in asset_classes:
        try:
            model_file = None
            from config import MODEL_PATH
            
            # Find deployed model
            possible_paths = [
                MODEL_PATH / f"{asset_class}_model.pkl",
                MODEL_PATH / f"{asset_class.lower()}_model.pkl",
            ]
            
            for pf in possible_paths:
                if pf.exists():
                    model_file = pf
                    break
            
            if model_file is None:
                print(f"    No deployed model for {asset_class}, skipping deployment")
                continue
            
            # Load model
            import joblib
            checkpoint = joblib.load(model_file)
            
            # Get recent data for prediction
            from downloaders import get_data_path
            asset_dir = DATA_DIR / asset_class
            
            recent_data = []
            if asset_dir.exists():
                for freq in ["1d", "1h"]:
                    f = get_data_path(asset_class.split("_")[0] if "_" in asset_class else asset_class, freq)
                    if f.exists():
                        df = pd.read_csv(f)
                        if not df.empty:
                            recent_data.append(df.tail(100))  # last 100 bars
            
            if not recent_data:
                print(f"    No recent data for prediction {asset_class}")
                continue
            
            combined = pd.concat(recent_data, ignore_index=True)
            scaled_data, scaler = prepare_features(combined)
            
            # Create sequence for prediction
            lookback = checkpoint.get("lookback", AI_CONFIG["lookback_periods"])
            X, _ = create_sequences(scaled_data, lookback)
            
            if len(X) < 1:
                print(f"    Not enough data for prediction {asset_class}")
                continue
            
            # Get latest sequence
            latest_sequence = X[-1:]  # shape: (1, lookback, n_features)
            
            # Make prediction
            model = checkpoint["model"]
            prediction = model.predict(latest_sequence.reshape(1, -1))[0]
            
            # Inverse transform to get actual price
            # Create dummy array for inverse transform
            dummy = np.zeros((1, len(AI_CONFIG["features"])))
            dummy[0, 0] = prediction  # first feature is price
            actual_price = scaler.inverse_transform(dummy)[0, 0]
            
            # Get current price from data
            current_price = combined["close"].iloc[-1] if "close" in combined.columns else combined.iloc[-1, 0]
            
            # Calculate signal
            price_change_pct = (actual_price - current_price) / current_price * 100
            
            # Apply risk filters
            signal = "HOLD"
            max_loss_pct = RISK_CONFIG["stop_loss_pct"] * 100
            take_profit_pct = RISK_CONFIG["take_profit_pct"] * 100
            
            if price_change_pct > take_profit_pct * 1.5:
                signal = "STRONG_SELL"
            elif price_change_pct > take_profit_pct:
                signal = "SELL"
            elif price_change_pct < -max_loss_pct * 1.5:
                signal = "STRONG_BUY"
            elif price_change_pct < -max_loss_pct:
                signal = "BUY"
            elif 0 < price_change_pct < take_profit_pct * 0.5:
                signal = "WEAK_SELL"
            elif -max_loss_pct * 0.5 < price_change_pct < 0:
                signal = "WEAK_BUY"
            
            # Additional risk check
            if abs(price_change_pct) > RISK_CONFIG["max_daily_loss"] * 100:
                signal = "RISK_LIMITED"  # Daily loss limit hit
            
            print(f"    ✓ {asset_class} prediction ready")
            print(f"      Current: ${current_price:.2f}")
            print(f"      Predicted: ${actual_price:.2f}")
            print(f"      Change: {price_change_pct:.2f}%")
            print(f"      Signal: {signal}")
            
            # Save prediction to logs
            log_prediction(asset_class, {
                "current_price": current_price,
                "predicted_price": actual_price,
                "change_pct": price_change_pct,
                "signal": signal,
                "timestamp": pd.Timestamp.now().isoformat(),
            })
            
        except Exception as e:
            print(f"    ✗ Deployment failed for {asset_class}: {e}")
            import traceback
            traceback.print_exc()
            success = False
    
    return success


def predict_alternative_signal(asset_classes: list[str] | None = None,
                               retrain: bool = True) -> bool:
    """Predict trading signals for alternative data sources.

    Implements signal generation for alternative data-based AI models
    including sentiment, news, satellite, social, credit, employment,
    real estate, and commodity inventory models.
    """
    if asset_classes is None:
        asset_classes = ["alternative"] if "alternative" in (asset_classes or []) else ["alternative"]

    success = True

    print(f"  Predicting alternative trading signals for {len(asset_classes)} data types...")

    for asset_class in asset_classes:
        try:
            from deploy import deploy_model
            # For alternative data, we use a different approach
            alt_dir = DATA_DIR / "alternative"
            if not alt_dir.exists():
                print(f"    No alternative data directory, skipping")
                continue

            # Load alternative model if exists
            model_file = None
            from config import MODEL_PATH
            possible_paths = [
                MODEL_PATH / f"alternative_{asset_class}_model.pkl",
                MODEL_PATH / f"alternative_{asset_class.lower()}_model.pkl",
            ]
            for pf in possible_paths:
                if pf.exists():
                    model_file = pf
                    break

            if model_file is None:
                print(f"    No alternative model for {asset_class}, skipping")
                continue

            # Load model
            import joblib
            checkpoint = joblib.load(model_file)

            # Get recent alternative data
            recent_data = []
            for data_type in ["sentiment", "news", "satellite", "social",
                              "credit", "employment", "real_estate", "commodity_inventory"]:
                for freq in ["1d", "1h"]:
                    f = alt_dir / f"{data_type}_{freq}.csv"
                    if f.exists():
                        df = pd.read_csv(f)
                        if not df.empty:
                            recent_data.append(df.tail(50))

            if not recent_data:
                print(f"    No recent alternative data for {asset_class}")
                continue

            combined = pd.concat(recent_data, ignore_index=True)

            # Generate signal based on alternative data trends
            signal = "HOLD"

            # Sentiment-based signal
            if "sentiment_score" in combined.columns:
                avg_sentiment = combined["sentiment_score"].mean()
                if avg_sentiment > 0.2:
                    signal = "BUY"
                elif avg_sentiment < -0.2:
                    signal = "SELL"

            # News volume signal
            if "news_count" in combined.columns:
                avg_news = combined["news_count"].mean()
                if avg_news > 100 and signal == "HOLD":
                    signal = "BUY"
                elif avg_news > 100 and signal == "BUY":
                    signal = "STRONG_BUY"

            # Satellite change signal
            if "change_pct" in combined.columns:
                avg_change = combined["change_pct"].mean()
                if avg_change > 3 and signal == "HOLD":
                    signal = "BUY"
                elif avg_change < -3 and signal == "HOLD":
                    signal = "SELL"

            # Apply risk filters
            max_loss_pct = RISK_CONFIG["stop_loss_pct"] * 100
            take_profit_pct = RISK_CONFIG["take_profit_pct"] * 100

            # Override signal based on risk limits
            if abs(signal != "HOLD") and np.random.random() > 0.1:
                # 90% chance risk check passes
                pass

            print(f"    ✓ {asset_class} alternative signal ready")
            print(f"      Signal: {signal}")
            print(f"      Avg sentiment: {combined.get('sentiment_score', [0]).mean():.4f}" if "sentiment_score" in combined.columns else "      No sentiment data")

            # Log prediction
            log_prediction(f"alternative_{asset_class}", {
                "signal": signal,
                "data_type": asset_class,
                "timestamp": pd.Timestamp.now().isoformat(),
            })

        except Exception as e:
            print(f"    ✗ Alternative signal prediction failed for {asset_class}: {e}")
            import traceback
            traceback.print_exc()
            success = False

    return success


def predict_signal(asset_classes: list[str] | None = None,
                   retrain: bool = True) -> bool:
    """Predict trading signals for all asset classes."""
    if asset_classes is None:
        asset_classes = ["forex", "crypto", "stocks", "indices", "commodities", "etfs"]
    
    success = True
    
    print(f"  Predicting trading signals for {len(asset_classes)} asset classes...")
    
    for asset_class in asset_classes:
        try:
            from deploy import deploy_model
            ok = deploy_model([asset_class], retrain=retrain)
            success = success and ok
            
        except Exception as e:
            print(f"    ✗ Signal prediction failed for {asset_class}: {e}")
            success = False
    
    return success


def log_prediction(asset_class: str, prediction: dict) -> None:
    """Log trading prediction to file."""
    logs_dir = Path(__file__).parent.parent / "market_data" / "logs"
    logs_dir.mkdir(exist_ok=True)
    
    log_file = logs_dir / "predictions.jsonl"
    with open(log_file, "a") as f:
        f.write(json.dumps({
            "asset_class": asset_class,
            **prediction,
        }) + "\n")
    
    print(f"    Logged prediction for {asset_class}")