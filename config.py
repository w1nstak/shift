import os
from dotenv import load_dotenv

load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN", "")
BOT_NAME = os.getenv("BOT_NAME", "Shift")
DB_PATH = os.path.join(os.path.dirname(__file__), "shift.db")
MINI_APP_URL = os.getenv("MINI_APP_URL", "https://w1nstak.github.io/shift/app/")

# Sea Battle real-time API (same host as bot by default)
GAME_API_HOST = os.getenv("GAME_API_HOST", "0.0.0.0")
GAME_API_PORT = int(os.getenv("GAME_API_PORT", "8787"))
# Public URL the Mini App uses (ngrok / VPS / Cloudflare Tunnel)
GAME_API_URL = os.getenv("GAME_API_URL", "").rstrip("/")
GAME_API_DEV = os.getenv("GAME_API_DEV", "0") == "1"

FOUNDER_ITEM = os.getenv("FOUNDER_ITEM", "брелок_репе")
FOUNDER_LIMIT = int(os.getenv("FOUNDER_LIMIT", "50"))
FOUNDER_PROFIT_BONUS = float(os.getenv("FOUNDER_PROFIT_BONUS", "0.10"))

PREFIXES = ("!", ".", "/")

SEA_BATTLE_STAKES = (10, 50, 100, 500, 1000)
SEA_BATTLE_MATCH_BOT_AFTER = float(os.getenv("SEA_BATTLE_MATCH_BOT_AFTER", "12"))
