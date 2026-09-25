"""Telegram WebApp initData verification."""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl


def verify_webapp_init_data(init_data: str, bot_token: str, max_age: int = 86400) -> dict | None:
    if not init_data or not bot_token:
        return None
    try:
        parsed = dict(parse_qsl(init_data, keep_blank_values=True))
    except Exception:
        return None
    received_hash = parsed.pop("hash", None)
    if not received_hash:
        return None
    data_check = "\n".join(f"{k}={v}" for k, v in sorted(parsed.items()))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    calc = hmac.new(secret, data_check.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(calc, received_hash):
        return None
    auth_date = int(parsed.get("auth_date") or 0)
    if auth_date and time.time() - auth_date > max_age:
        return None
    user = None
    if "user" in parsed:
        try:
            user = json.loads(parsed["user"])
        except Exception:
            user = None
    return {"user": user, "auth_date": auth_date, "raw": parsed}
