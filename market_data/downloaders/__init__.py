# Market Data Downloaders Package
# Institutional-grade market data downloaders for multiple asset classes

from downloaders.forex import download_forex_data
from downloaders.crypto import download_crypto_data
from downloaders.stocks import download_stock_data
from downloaders.index import download_index_data
from downloaders.commodities import download_commodity_data
from downloaders.etf import download_etf_data
from downloaders.alternative import download_alternative_data

# Utility functions
from config import ASSET_CLASSES, FREQUENCIES

def get_data_path(symbol: str, frequency: str = "1d"):
    """Get the data file path for a symbol and frequency."""
    from config import get_data_path as _get_data_path
    return _get_data_path(symbol, frequency)

def get_model_path(symbol: str):
    """Get the model file path for a symbol."""
    from config import get_model_path as _get_model_path
    return _get_model_path(symbol)

__all__ = [
    "download_forex_data",
    "download_crypto_data",
    "download_stock_data",
    "download_index_data",
    "download_commodity_data",
    "download_etf_data",
    "download_alternative_data",
    "get_data_path",
    "get_model_path",
]