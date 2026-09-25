import os
from dotenv import load_dotenv

load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN", "")
BOT_NAME = os.getenv("BOT_NAME", "Shift")
DB_PATH = os.path.join(os.path.dirname(__file__), "shift.db")
MINI_APP_URL = os.getenv("MINI_APP_URL", "https://w1nstak.github.io/shift/app/")

PREFIXES = ("!", ".", "/")
