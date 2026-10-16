import os
from pathlib import Path

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
LOGS_DIR = BASE_DIR / "logs"
MODEL_PATH = BASE_DIR / "models"

DATA_DIR.mkdir(exist_ok=True)
LOGS_DIR.mkdir(exist_ok=True)
MODEL_PATH.mkdir(exist_ok=True)

# Asset classes
ASSET_CLASSES = ["forex", "crypto", "stocks", "indices", "commodities", "etfs", "alternative"]

# Data frequencies
FREQUENCIES = ["tick", "1min", "5min", "15min", "1h", "4h", "1d", "1w"]

# Institutional data sources
DATA_SOURCES = {
    "forex": {
        "primary": "OANDA",
        "secondary": ["Bloomberg", "Reuters", "Refinitiv"],
        "pairs": ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CHF"],
    },
    "crypto": {
        "primary": "CoinGecko",
        "secondary": ["Binance", "Coinbase Pro", "Kraken"],
        "coins": ["BTC", "ETH", "ADA", "DOT", "LINK"],
    },
    "stocks": {
        "primary": "Alpha Vantage",
        "secondary": ["Yahoo Finance", "IEX Cloud"],
        "symbols": ["AAPL", "MSFT", "GOOGL", "AMZN", "TSLA"],
    },
    "indices": {
        "primary": "CBOE",
        "secondary": ["Yahoo Finance"],
        "symbols": ["SPX", "DJIA", "NASDAQ", "Russell 2000"],
    },
    "commodities": {
        "primary": "CME",
        "secondary": ["LME", "NYMEX"],
        "symbols": ["Gold", "Silver", "Crude Oil", "Natural Gas", "Wheat"],
    },
    "etfs": {
        "primary": "iShares",
        "secondary": ["Vanguard", "State Street"],
        "symbols": ["SPY", "QQQ", "IWM", "GLD", "SLV"],
    },
    "alternative": {
        "primary": "Multiple Premium Sources",
        "secondary": None,
        "data_types": [
            "sentiment",
            "news",
            "satellite",
            "social",
            "credit",
            "employment",
            "real_estate",
            "commodity_inventory",
        ],
        "providers": {
            "sentiment": ["Bloomberg Terminal", "Refinitiv", "FactSet"],
            "news": ["Dow Jones Newswire", "PR Newswire", "Business Wire"],
            "satellite": ["Planet Labs", "Maxar Technologies"],
            "social": ["Twitter API", "Reddit API", "StockTwits"],
            "credit": ["Equifax", "Experian", "TransUnion"],
            "employment": ["BLS", "ADP", "Payroll processing services"],
            "real_estate": ["County records", "Zillow Research", "Redwood"],
            "commodity_inventory": ["EIA", "ICIS", "Argus"],
        },
    },
}

# AI/ML configuration
AI_CONFIG = {
    "model_type": "LSTM",
    "lookback_periods": 100,
    "prediction_horizons": ["1min", "5min", "15min", "1h", "4h"],
    "features": [
        "open", "high", "low", "close", "volume",
        "rsi", "macd", "bb_upper", "bb_lower",
        "vwap", "volume_ma", "price_change",
    ],
    "retrain_interval": 3600,  # seconds
}

# Alternative data AI configuration
ALTERNATIVE_AI_CONFIG = {
    "model_type": "Transformer",
    "lookback_periods": 365,
    "prediction_horizons": ["1d", "1w", "1m"],
    "alternative_features": [
        "sentiment_score",
        "news_volume",
        "satellite_change_pct",
        "social_engagement",
        "credit_spread",
        "employment_rate",
        "inventory_level",
        "real_estate_price",
    ],
    "retrain_interval": 86400,  # daily retrain for alt data
}

# Risk management
RISK_CONFIG = {
    "max_position_size": 0.1,  # 10% of capital
    "max_daily_loss": 0.05,  # 5% of capital
    "stop_loss_pct": 0.02,  # 2%
    "take_profit_pct": 0.04,  # 4%
    "max_drawdown": 0.15,  # 15%
}

# Logging
LOG_LEVEL = "INFO"
LOG_FORMAT = "%Y-%m-%d %H:%M:%S %Z"


def get_asset_class(symbol: str) -> str:
    """Determine asset class from symbol."""
    crypto_symbols = ["BTC", "ETH", "ADA", "DOT", "LINK", "SOL", "XRP"]
    stock_symbols = ["AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "NVDA", "META"]
    
    symbol_upper = symbol.upper()
    if symbol_upper in crypto_symbols:
        return "crypto"
    if symbol_upper in stock_symbols:
        return "stocks"
    if "/" in symbol_upper:
        return "forex"
    return "stocks"


def get_data_path(symbol: str, frequency: str = "1d") -> Path:
    """Get the data file path for a symbol and frequency."""
    asset_class = get_asset_class(symbol)
    return DATA_DIR / asset_class / f"{symbol}_{frequency}.csv"


def get_model_path(symbol: str) -> Path:
    """Get the model file path for a symbol."""
    return MODEL_PATH / f"{symbol}_model.pkl"


def get_alternative_data_path(data_type: str, frequency: str = "1d") -> Path:
    """Get the alternative data file path for a data type and frequency."""
    return DATA_DIR / "alternative" / f"{data_type}_{frequency}.csv"


def is_alternative_data(symbol: str) -> bool:
    """Check if symbol represents alternative data type."""
    alternative_types = {"sentiment", "news", "satellite", "social", "credit", 
                         "employment", "real_estate", "commodity_inventory"}
    return symbol.lower() in alternative_types


def get_asset_class(symbol: str) -> str:
    """Determine asset class from symbol."""
    crypto_symbols = ["BTC", "ETH", "ADA", "DOT", "LINK", "SOL", "XRP"]
    stock_symbols = ["AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "NVDA", "META"]
    
    symbol_upper = symbol.upper()
    if symbol_upper in crypto_symbols:
        return "crypto"
    if symbol_upper in stock_symbols:
        return "stocks"
    if "/" in symbol_upper:
        return "forex"
    return "stocks"


def get_data_path(symbol: str, frequency: str = "1d") -> Path:
    """Get the data file path for a symbol and frequency."""
    asset_class = get_asset_class(symbol)
    return DATA_DIR / asset_class / f"{symbol}_{frequency}.csv"


def get_model_path(symbol: str) -> Path:
    """Get the model file path for a symbol."""
    return MODEL_PATH / f"{symbol}_model.pkl"