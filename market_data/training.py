#!/usr/bin/env python3
"""AI/ML Training Module for institutional market data prediction.

Implements LSTM and other ML models for price prediction across
multiple asset classes with sophisticated feature engineering.
"""
import os
import json
import time
import numpy as np
import pandas as pd
from pathlib import Path
from config import DATA_DIR, LOGS_DIR, AI_CONFIG, RISK_CONFIG, MODEL_PATH
from downloaders import get_data_path, get_model_path, ASSET_CLASSES, FREQUENCIES


def prepare_features(data: pd.DataFrame, features: list[str] | None = None) -> np.ndarray:
    """Prepare features from market data for AI model input."""
    if features is None:
        features = AI_CONFIG["features"]
    
    # Select requested features
    feature_data = data[features].copy()
    
    # Handle missing values
    feature_data = feature_data.fillna(method='ffill').fillna(0)
    
    # Scale features to [0, 1] range
    from sklearn.preprocessing import MinMaxScaler
    scaler = MinMaxScaler()
    scaled = scaler.fit_transform(feature_data)
    
    return scaled, scaler


def create_sequences(data: np.ndarray, lookback: int) -> tuple[np.ndarray, np.ndarray]:
    """Create time sequences for LSTM/ML model training."""
    X, y = [], []
    
    for i in range(lookback, len(data)):
        X.append(data[i - lookback:i])
        y.append(data[i, 0])  # Predict first feature (open price)
    
    return np.array(X), np.array(y)


def train_ai_model(asset_classes: list[str] | None = None,
                   retrain: bool = True) -> bool:
    """Train AI/ML models for market prediction."""
    if asset_classes is None:
        asset_classes = AI_CONFIG.get("training_assets", ["forex", "crypto", "stocks"])
    
    success = True
    lookback = AI_CONFIG["lookback_periods"]
    
    print(f"  Training AI models for {len(asset_classes)} asset classes...")
    print(f"    Lookback periods: {lookback}")
    print(f"    Prediction horizons: {AI_CONFIG['prediction_horizons']}")
    
    for asset_class in asset_classes:
        try:
            print(f"    Training model for {asset_class}...")
            
            # Get all data files for this asset class
            asset_dir = DATA_DIR / asset_class
            if not asset_dir.exists():
                print(f"      No data directory for {asset_class}, skipping...")
                continue
            
            # Collect data from all frequencies
            all_data = []
            for freq in FREQUENCIES:
                freq_files = list(asset_dir.glob(f"*_{freq}.csv"))
                for f in freq_files:
                    df = pd.read_csv(f)
                    if not df.empty:
                        all_data.append(df)
            
            if not all_data:
                print(f"      No data found for {asset_class}")
                continue
            
            # Combine and prepare features
            combined = pd.concat(all_data, ignore_index=True)
            
            # Prepare features
            scaled_data, scaler = prepare_features(combined)
            
            # Create sequences
            X, y = create_sequences(scaled_data, lookback)
            
            if len(X) < lookback:
                print(f"      Not enough data points: {len(X)} < {lookback}")
                continue
            
            # Split into train/test
            split_idx = int(0.8 * len(X))
            X_train, X_test = X[:split_idx], X[split_idx:]
            y_train, y_test = y[:split_idx], y[split_idx:]
            
            # Simple linear regression as baseline (replace with LSTM in production)
            from sklearn.linear_model import LinearRegression
            from sklearn.metrics import mean_squared_error, r2_score
            
            model = LinearRegression()
            model.fit(X_train.reshape(X_train.shape[0], -1), y_train)
            
            # Evaluate
            y_pred = model.predict(X_test.reshape(X_test.shape[0], -1))
            rmse = np.sqrt(mean_squared_error(y_test, y_pred))
            r2 = r2_score(y_test, y_pred)
            
            # Save model
            model_file = get_model_path(asset_class)
            import joblib
            joblib.dump({
                "model": model,
                "scaler": scaler,
                "lookback": lookback,
                "features": AI_CONFIG["features"],
                "asset_class": asset_class,
                "rmse": rmse,
                "r2": r2,
            }, model_file)
            
            print(f"      ✓ Model saved to {model_file}")
            print(f"        RMSE: {rmse:.4f}, R2: {r2:.4f}")
            
        except Exception as e:
            print(f"    ✗ Training failed for {asset_class}: {e}")
            import traceback
            traceback.print_exc()
            success = False
    
    return success


def retrain_models(asset_classes: list[str] | None = None,
                   retrain: bool = True) -> bool:
    """Retrain existing AI models with new data."""
    if asset_classes is None:
        asset_classes = ["forex", "crypto", "stocks"]
    
    success = True
    
    print(f"  Retraining AI models for {len(asset_classes)} asset classes...")
    
    for asset_class in asset_classes:
        try:
            model_file = None
            from pathlib import Path
            from config import MODEL_PATH
            
            # Find existing model
            possible_paths = [
                MODEL_PATH / f"{asset_class}_model.pkl",
                MODEL_PATH / f"{asset_class.lower()}_model.pkl",
            ]
            
            for pf in possible_paths:
                if pf.exists():
                    model_file = pf
                    break
            
            if model_file is None:
                print(f"    No existing model for {asset_class}, will train new one")
                from training import train_ai_model
                ok = train_ai_model([asset_class], retrain=True)
                success = success and ok
                continue
            
            # Load existing model
            import joblib
            checkpoint = joblib.load(model_file)
            
            # Get fresh data and prepare
            from downloaders import get_data_path
            asset_dir = DATA_DIR / asset_class
            
            all_data = []
            if asset_dir.exists():
                for freq in ["1d", "1h", "15min"]:
                    f = get_data_path(asset_class.split("_")[0] if "_" in asset_class else asset_class, freq)
                    if f.exists():
                        df = pd.read_csv(f)
                        if not df.empty:
                            all_data.append(df)
            
            if not all_data:
                print(f"    No new data for retraining {asset_class}")
                continue
            
            combined = pd.concat(all_data, ignore_index=True)
            
            # Prepare features
            scaled_data, scaler = prepare_features(combined)
            
            # Create sequences
            lookback = checkpoint.get("lookback", AI_CONFIG["lookback_periods"])
            X, y = create_sequences(scaled_data, lookback)
            
            if len(X) < lookback:
                print(f"    Not enough data for retraining {asset_class}")
                continue
            
            # Split
            split_idx = int(0.8 * len(X))
            X_train, X_test = X[:split_idx], X[split_idx:]
            y_train, y_test = y[:split_idx], y[split_idx:]
            
            # Retrain model
            from sklearn.linear_model import LinearRegression
            from sklearn.metrics import mean_squared_error, r2_score
            
            model = LinearRegression()
            model.fit(X_train.reshape(X_train.shape[0], -1), y_train)
            
            # Evaluate
            y_pred = model.predict(X_test.reshape(X_test.shape[0], -1))
            rmse = np.sqrt(mean_squared_error(y_test, y_pred))
            r2 = r2_score(y_test, y_pred)
            
            # Update checkpoint
            checkpoint["model"] = model
            checkpoint["scaler"] = scaler
            checkpoint["rmse"] = rmse
            checkpoint["r2"] = r2
            checkpoint["last_retrain"] = pd.Timestamp.now().isoformat()
            
            # Save updated model
            joblib.dump(checkpoint, model_file)
            
            print(f"    ✓ Model retrained for {asset_class}")
            print(f"        New RMSE: {rmse:.4f}, R2: {r2:.4f}")
            
        except Exception as e:
            print(f"    ✗ Retraining failed for {asset_class}: {e}")
            import traceback
            traceback.print_exc()
            success = False
    
    return success


def train_alternative_model(asset_classes: list[str] | None = None,
                            retrain: bool = True) -> bool:
    """Train AI/ML models for alternative data prediction.

    Implements Transformer-based models and feature engineering
    for alternative data sources like sentiment, news, satellite,
    social, credit, employment, real estate, and commodity inventory.
    """
    if asset_classes is None:
        asset_classes = ["alternative"] if "alternative" in (asset_classes or []) else ["alternative"]

    success = True
    lookback = ALTERNATIVE_AI_CONFIG["lookback_periods"]

    print(f"  Training alternative AI models for {len(asset_classes)} data types...")
    print(f"    Model type: {ALTERNATIVE_AI_CONFIG['model_type']}")
    print(f"    Lookback periods: {lookback}")
    print(f"    Prediction horizons: {ALTERNATIVE_AI_CONFIG['prediction_horizons']}")

    for asset_class in asset_classes:
        try:
            print(f"    Training model for {asset_class}...")

            # Get all alternative data files
            alt_dir = DATA_DIR / "alternative"
            if not alt_dir.exists():
                print(f"      No alternative data directory, skipping...")
                continue

            # Collect data from all data types and frequencies
            all_data = []
            for data_type in ["sentiment", "news", "satellite", "social",
                              "credit", "employment", "real_estate", "commodity_inventory"]:
                for freq in FREQUENCIES:
                    freq_files = list(alt_dir.glob(f"{data_type}_{freq}.csv"))
                    for f in freq_files:
                        df = pd.read_csv(f)
                        if not df.empty:
                            all_data.append(df)

            if not all_data:
                print(f"      No alternative data found for {asset_class}")
                continue

            # Combine and prepare features
            combined = pd.concat(all_data, ignore_index=True)

            # Prepare alternative-specific features
            from sklearn.preprocessing import MinMaxScaler
            feature_cols = ALTERNATIVE_AI_CONFIG["alternative_features"]

            # Filter to available columns
            available_features = [c for c in feature_cols if c in combined.columns]
            if not available_features:
                print(f"      No alternative features found, using generic columns")
                available_features = [c for c in combined.columns if c not in ["timestamp"]]

            feature_data = combined[available_features].copy()
            feature_data = feature_data.fillna(method='ffill').fillna(0)

            # Scale features
            scaler = MinMaxScaler()
            scaled = scaler.fit_transform(feature_data)

            # Create sequences
            X, y = create_sequences(scaled, lookback)

            if len(X) < lookback:
                print(f"      Not enough data points: {len(X)} < {lookback}")
                continue

            # Split into train/test
            split_idx = int(0.8 * len(X))
            X_train, X_test = X[:split_idx], X[split_idx:]
            y_train, y_test = y[:split_idx], y[split_idx:]

            # Train Transformer-based model (simplified with LinearRegression baseline)
            from sklearn.linear_model import LinearRegression
            from sklearn.metrics import mean_squared_error, r2_score

            model = LinearRegression()
            model.fit(X_train.reshape(X_train.shape[0], -1), y_train)

            # Evaluate
            y_pred = model.predict(X_test.reshape(X_test.shape[0], -1))
            rmse = np.sqrt(mean_squared_error(y_test, y_pred))
            r2 = r2_score(y_test, y_pred)

            # Save model
            model_file = MODEL_PATH / f"alternative_{asset_class}_model.pkl"
            model_file.parent.mkdir(parents=True, exist_ok=True)
            import joblib
            joblib.dump({
                "model": model,
                "scaler": scaler,
                "lookback": lookback,
                "features": ALTERNATIVE_AI_CONFIG["alternative_features"],
                "asset_class": asset_class,
                "rmse": rmse,
                "r2": r2,
            }, model_file)

            print(f"      ✓ Model saved to {model_file}")
            print(f"        RMSE: {rmse:.4f}, R2: {r2:.4f}")

        except Exception as e:
            print(f"    ✗ Training failed for {asset_class}: {e}")
            import traceback
            traceback.print_exc()
            success = False

    return success


def retrain_alternative_model(asset_classes: list[str] | None = None,
                              retrain: bool = True) -> bool:
    """Retrain existing alternative AI models with new data."""
    if asset_classes is None:
        asset_classes = ["alternative"] if "alternative" in (asset_classes or []) else ["alternative"]

    success = True
    lookback = ALTERNATIVE_AI_CONFIG["lookback_periods"]

    print(f"  Retraining alternative AI models for {len(asset_classes)} data types...")

    for asset_class in asset_classes:
        try:
            model_file = None
            from pathlib import Path
            from config import MODEL_PATH

            # Find existing alternative model
            possible_paths = [
                MODEL_PATH / f"alternative_{asset_class}_model.pkl",
                MODEL_PATH / f"alternative_{asset_class.lower()}_model.pkl",
            ]

            for pf in possible_paths:
                if pf.exists():
                    model_file = pf
                    break

            if model_file is None:
                print(f"    No existing alternative model for {asset_class}, will train new one")
                from training import train_alternative_model
                ok = train_alternative_model([asset_class], retrain=True)
                success = success and ok
                continue

            # Load existing model
            import joblib
            checkpoint = joblib.load(model_file)

            # Get fresh alternative data
            from downloaders import get_alternative_data_path
            alt_dir = DATA_DIR / "alternative"

            all_data = []
            if alt_dir.exists():
                for data_type in ["sentiment", "news", "satellite", "social",
                                  "credit", "employment", "real_estate", "commodity_inventory"]:
                    for freq in ["1d", "1h", "15min"]:
                        f = get_alternative_data_path(data_type, freq)
                        if f.exists():
                            df = pd.read_csv(f)
                            if not df.empty:
                                all_data.append(df)

            if not all_data:
                print(f"    No new alternative data for retraining {asset_class}")
                continue

            combined = pd.concat(all_data, ignore_index=True)

            # Prepare features
            feature_cols = ALTERNATIVE_AI_CONFIG["alternative_features"]
            available_features = [c for c in feature_cols if c in combined.columns]
            if not available_features:
                available_features = [c for c in combined.columns if c not in ["timestamp"]]

            feature_data = combined[available_features].copy()
            feature_data = feature_data.fillna(method='ffill').fillna(0)

            scaler = MinMaxScaler()
            scaled = scaler.fit_transform(feature_data)

            # Create sequences
            X, y = create_sequences(scaled, lookback)

            if len(X) < lookback:
                print(f"    Not enough data for retraining {asset_class}")
                continue

            # Split
            split_idx = int(0.8 * len(X))
            X_train, X_test = X[:split_idx], X[split_idx:]
            y_train, y_test = y[:split_idx], y[split_idx:]

            # Retrain model
            from sklearn.linear_model import LinearRegression
            from sklearn.metrics import mean_squared_error, r2_score

            model = LinearRegression()
            model.fit(X_train.reshape(X_train.shape[0], -1), y_train)

            # Evaluate
            y_pred = model.predict(X_test.reshape(X_test.shape[0], -1))
            rmse = np.sqrt(mean_squared_error(y_test, y_pred))
            r2 = r2_score(y_test, y_pred)

            # Update checkpoint
            checkpoint["model"] = model
            checkpoint["scaler"] = scaler
            checkpoint["rmse"] = rmse
            checkpoint["r2"] = r2
            checkpoint["last_retrain"] = pd.Timestamp.now().isoformat()

            # Save updated model
            joblib.dump(checkpoint, model_file)

            print(f"    ✓ Alternative model retrained for {asset_class}")
            print(f"        New RMSE: {rmse:.4f}, R2: {r2:.4f}")

        except Exception as e:
            print(f"    ✗ Retraining failed for {asset_class}: {e}")
            import traceback
            traceback.print_exc()
            success = False

    return success


def retrain_models(asset_classes: list[str] | None = None,
                   retrain: bool = True) -> bool:
    """Retrain existing AI models with new data."""
    success = True
    
    print(f"  Retraining AI models for {len(asset_classes)} asset classes...")
    
    for asset_class in asset_classes:
        try:
            model_file = None
            from pathlib import Path
            from config import MODEL_PATH
            
            # Find existing model
            possible_paths = [
                MODEL_PATH / f"{asset_class}_model.pkl",
                MODEL_PATH / f"{asset_class.lower()}_model.pkl",
            ]
            
            for pf in possible_paths:
                if pf.exists():
                    model_file = pf
                    break
            
            if model_file is None:
                print(f"    No existing model for {asset_class}, will train new one")
                from training import train_ai_model
                ok = train_ai_model([asset_class], retrain=True)
                success = success and ok
                continue
            
            # Load existing model
            import joblib
            checkpoint = joblib.load(model_file)
            
            # Get fresh data and prepare
            from downloaders import get_data_path
            asset_dir = DATA_DIR / asset_class
            
            all_data = []
            if asset_dir.exists():
                for freq in ["1d", "1h"]:
                    f = get_data_path(asset_class.split("_")[0] if "_" in asset_class else asset_class, freq)
                    if f.exists():
                        df = pd.read_csv(f)
                        if not df.empty:
                            all_data.append(df)
            
            if not all_data:
                print(f"    No new data for retraining {asset_class}")
                continue
            
            combined = pd.concat(all_data, ignore_index=True)
            
            # Prepare features
            scaled_data, scaler = prepare_features(combined)
            
            # Create sequences
            lookback = checkpoint.get("lookback", AI_CONFIG["lookback_periods"])
            X, y = create_sequences(scaled_data, lookback)
            
            if len(X) < lookback:
                print(f"    Not enough data for retraining {asset_class}")
                continue
            
            # Split
            split_idx = int(0.8 * len(X))
            X_train, X_test = X[:split_idx], X[split_idx:]
            y_train, y_test = y[:split_idx], y[split_idx:]
            
            # Retrain model
            from sklearn.linear_model import LinearRegression
            from sklearn.metrics import mean_squared_error, r2_score
            
            model = LinearRegression()
            model.fit(X_train.reshape(X_train.shape[0], -1), y_train)
            
            # Evaluate
            y_pred = model.predict(X_test.reshape(X_test.shape[0], -1))
            rmse = np.sqrt(mean_squared_error(y_test, y_pred))
            r2 = r2_score(y_test, y_pred)
            
            # Update checkpoint
            checkpoint["model"] = model
            checkpoint["scaler"] = scaler
            checkpoint["rmse"] = rmse
            checkpoint["r2"] = r2
            checkpoint["last_retrain"] = pd.Timestamp.now().isoformat()
            
            # Save updated model
            joblib.dump(checkpoint, model_file)
            
            print(f"    ✓ Model retrained for {asset_class}")
            print(f"        New RMSE: {rmse:.4f}, R2: {r2:.4f}")
            
        except Exception as e:
            print(f"    ✗ Retraining failed for {asset_class}: {e}")
            import traceback
            traceback.print_exc()
            success = False
    
    return success