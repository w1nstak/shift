"""Shift ecosystem tables: rating, fleets chat, friends, missions, wallet tx, notifications."""
from __future__ import annotations

import json
import time
from typing import Any

import aiosqlite

from config import DB_PATH

LEAGUES = (
    (0, "Bronze"),
    (1000, "Silver"),
    (1500, "Gold"),
    (2000, "Platinum"),
    (2500, "Diamond"),
    (3000, "Admiral"),
)

DAILY_MISSIONS = (
    {"id": "win_1", "title": "WIN 1 BATTLE", "target": 1, "metric": "wins", "reward_coins": 30, "reward_xp": 40},
    {"id": "win_3", "title": "WIN 3 BATTLES", "target": 3, "metric": "wins", "reward_coins": 100, "reward_xp": 120},
    {"id": "play_5", "title": "PLAY 5 GAMES", "target": 5, "metric": "games", "reward_coins": 50, "reward_xp": 80},
    {"id": "hit_20", "title": "HIT 20 SHIPS", "target": 20, "metric": "hits", "reward_coins": 60, "reward_xp": 90},
    {"id": "acc_80", "title": "WIN WITH 80% ACCURACY", "target": 1, "metric": "acc80", "reward_coins": 80, "reward_xp": 100},
)

ARENAS = ("pacific", "arctic", "sunset", "deep_sea", "volcanic", "night")
COSMETICS = (
    {"id": "skin_steel", "type": "skin", "name": "Steel Fleet", "price": 0},
    {"id": "skin_gold", "type": "skin", "name": "Gold Wake", "price": 200},
    {"id": "flag_shift", "type": "flag", "name": "Shift Flag", "price": 0},
    {"id": "flag_storm", "type": "flag", "name": "Storm Banner", "price": 150},
    {"id": "fx_spark", "type": "hit", "name": "Spark Hits", "price": 120},
    {"id": "frame_admiral", "type": "frame", "name": "Admiral Frame", "price": 300},
)


def league_for(rating: int) -> dict:
    name = "Bronze"
    next_at = 1000
    for thr, n in LEAGUES:
        if rating >= thr:
            name = n
    for i, (thr, n) in enumerate(LEAGUES):
        if n == name:
            next_at = LEAGUES[i + 1][0] if i + 1 < len(LEAGUES) else thr
            prev = thr
            break
    else:
        prev = 0
    progress = 100 if name == "Admiral" else max(0, min(100, int((rating - prev) / max(1, next_at - prev) * 100)))
    return {"league": name, "rating": rating, "next": next_at, "progress": progress}


async def ensure_eco_tables() -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript(
            """
            CREATE TABLE IF NOT EXISTS shift_profiles (
                user_id INTEGER NOT NULL,
                chat_id INTEGER NOT NULL,
                rating INTEGER DEFAULT 1000,
                sea_xp INTEGER DEFAULT 0,
                sea_level INTEGER DEFAULT 1,
                streak INTEGER DEFAULT 0,
                best_streak INTEGER DEFAULT 0,
                arena TEXT DEFAULT 'pacific',
                cosmetics TEXT DEFAULT '{}',
                season_xp INTEGER DEFAULT 0,
                season_level INTEGER DEFAULT 1,
                daily_claim REAL DEFAULT 0,
                PRIMARY KEY (user_id, chat_id)
            );

            CREATE TABLE IF NOT EXISTS wallet_tx (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                chat_id INTEGER NOT NULL,
                amount INTEGER NOT NULL,
                kind TEXT NOT NULL,
                meta TEXT DEFAULT '',
                created_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS shift_friends (
                user_id INTEGER NOT NULL,
                chat_id INTEGER NOT NULL,
                friend_id INTEGER NOT NULL,
                status TEXT DEFAULT 'accepted',
                created_at REAL NOT NULL,
                PRIMARY KEY (user_id, chat_id, friend_id)
            );

            CREATE TABLE IF NOT EXISTS shift_challenges (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                from_id INTEGER NOT NULL,
                to_id INTEGER NOT NULL,
                chat_id INTEGER NOT NULL,
                stake INTEGER NOT NULL,
                status TEXT DEFAULT 'pending',
                room_code TEXT,
                created_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS fleet_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                clan_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                name TEXT DEFAULT '',
                text TEXT NOT NULL,
                kind TEXT DEFAULT 'user',
                created_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS shift_missions (
                user_id INTEGER NOT NULL,
                chat_id INTEGER NOT NULL,
                day_key TEXT NOT NULL,
                progress TEXT DEFAULT '{}',
                claimed TEXT DEFAULT '{}',
                PRIMARY KEY (user_id, chat_id, day_key)
            );

            CREATE TABLE IF NOT EXISTS shift_notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                chat_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                body TEXT DEFAULT '',
                kind TEXT DEFAULT 'info',
                read INTEGER DEFAULT 0,
                created_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS match_replays (
                room_id TEXT PRIMARY KEY,
                chat_id INTEGER,
                stake INTEGER,
                winner_id INTEGER,
                payload TEXT NOT NULL,
                created_at REAL NOT NULL
            );
            """
        )
        await db.commit()


async def get_or_create_profile(user_id: int, chat_id: int) -> dict:
    await ensure_eco_tables()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute(
            """
            INSERT INTO shift_profiles (user_id, chat_id) VALUES (?, ?)
            ON CONFLICT(user_id, chat_id) DO NOTHING
            """,
            (user_id, chat_id),
        )
        await db.commit()
        async with db.execute(
            "SELECT * FROM shift_profiles WHERE user_id = ? AND chat_id = ?",
            (user_id, chat_id),
        ) as cur:
            row = await cur.fetchone()
            return dict(row) if row else {}


async def add_wallet_tx(user_id: int, chat_id: int, amount: int, kind: str, meta: str = "") -> None:
    await ensure_eco_tables()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO wallet_tx (user_id, chat_id, amount, kind, meta, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, chat_id, amount, kind, meta, time.time()),
        )
        await db.commit()


async def list_wallet_tx(user_id: int, chat_id: int, limit: int = 30) -> list[dict]:
    await ensure_eco_tables()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM wallet_tx WHERE user_id = ? AND chat_id = ? ORDER BY id DESC LIMIT ?",
            (user_id, chat_id, limit),
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]


async def apply_match_rating(
    winner_id: int,
    loser_id: int,
    chat_id: int,
    stake: int,
    winner_shots: int,
    winner_hits: int,
    won_vs_bot: bool,
) -> dict:
    """Update rating, streak, missions. Returns winner/loser rating deltas."""
    await ensure_eco_tables()

    # Bot won — only punish/xp the human loser lightly
    if winner_id < 0 and loser_id > 0:
        l = await get_or_create_profile(loser_id, chat_id)
        l_rating = max(0, int(l.get("rating") or 1000) - (8 if won_vs_bot else 16))
        l_xp = int(l.get("sea_xp") or 0) + 12
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "UPDATE shift_profiles SET rating = ?, streak = 0, sea_xp = ? WHERE user_id = ? AND chat_id = ?",
                (l_rating, l_xp, loser_id, chat_id),
            )
            await db.commit()
        await bump_missions(loser_id, chat_id, games=1)
        return {
            "winner": None,
            "loser": {"rating": l_rating, "delta": l_rating - int(l.get("rating") or 1000), "league": league_for(l_rating)},
        }

    w = await get_or_create_profile(winner_id, chat_id)
    l = await get_or_create_profile(loser_id, chat_id) if loser_id > 0 else None

    w_gain = 18 if won_vs_bot else 28
    l_loss = 0 if won_vs_bot or not l else 16
    w_rating = int(w.get("rating") or 1000) + w_gain
    w_streak = int(w.get("streak") or 0) + 1
    w_best = max(int(w.get("best_streak") or 0), w_streak)
    w_xp = int(w.get("sea_xp") or 0) + 35 + stake // 20
    w_sxp = int(w.get("season_xp") or 0) + 25

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            UPDATE shift_profiles SET rating = ?, streak = ?, best_streak = ?,
                sea_xp = ?, season_xp = ?
            WHERE user_id = ? AND chat_id = ?
            """,
            (w_rating, w_streak, w_best, w_xp, w_sxp, winner_id, chat_id),
        )
        if l and loser_id > 0:
            l_rating = max(0, int(l.get("rating") or 1000) - l_loss)
            l_xp = int(l.get("sea_xp") or 0) + 12
            await db.execute(
                """
                UPDATE shift_profiles SET rating = ?, streak = 0, sea_xp = ?, season_xp = season_xp + 10
                WHERE user_id = ? AND chat_id = ?
                """,
                (l_rating, l_xp, loser_id, chat_id),
            )
        await db.commit()

    await bump_missions(winner_id, chat_id, wins=1, games=1, hits=winner_hits, acc80=1 if winner_shots and winner_hits / max(1, winner_shots) >= 0.8 else 0)
    if loser_id > 0:
        await bump_missions(loser_id, chat_id, games=1)

    return {
        "winner": {"rating": w_rating, "delta": w_gain, "streak": w_streak, "league": league_for(w_rating)},
        "loser": {"rating": (l_rating if l else 0), "delta": -l_loss, "league": league_for(l_rating if l else 1000)} if l else None,
    }


async def _day_key() -> str:
    return time.strftime("%Y-%m-%d", time.gmtime())


async def get_missions(user_id: int, chat_id: int) -> dict:
    await ensure_eco_tables()
    day = await _day_key()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        await db.execute(
            """
            INSERT INTO shift_missions (user_id, chat_id, day_key) VALUES (?, ?, ?)
            ON CONFLICT(user_id, chat_id, day_key) DO NOTHING
            """,
            (user_id, chat_id, day),
        )
        await db.commit()
        async with db.execute(
            "SELECT * FROM shift_missions WHERE user_id = ? AND chat_id = ? AND day_key = ?",
            (user_id, chat_id, day),
        ) as cur:
            row = dict(await cur.fetchone())
    progress = json.loads(row.get("progress") or "{}")
    claimed = json.loads(row.get("claimed") or "{}")
    items = []
    for m in DAILY_MISSIONS:
        cur_v = int(progress.get(m["id"], 0))
        items.append({
            **m,
            "current": cur_v,
            "done": cur_v >= m["target"],
            "claimed": bool(claimed.get(m["id"])),
        })
    return {"day": day, "missions": items}


async def bump_missions(user_id: int, chat_id: int, wins: int = 0, games: int = 0, hits: int = 0, acc80: int = 0) -> None:
    data = await get_missions(user_id, chat_id)
    progress = {}
    for m in data["missions"]:
        progress[m["id"]] = int(m["current"])
    # map metrics
    mapping = {"win_1": wins, "win_3": wins, "play_5": games, "hit_20": hits, "acc_80": acc80}
    for mid, add in mapping.items():
        if add:
            progress[mid] = progress.get(mid, 0) + add
    day = data["day"]
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE shift_missions SET progress = ? WHERE user_id = ? AND chat_id = ? AND day_key = ?",
            (json.dumps(progress), user_id, chat_id, day),
        )
        await db.commit()


async def claim_mission(user_id: int, chat_id: int, mission_id: str) -> dict:
    import db as core_db

    data = await get_missions(user_id, chat_id)
    m = next((x for x in data["missions"] if x["id"] == mission_id), None)
    if not m:
        raise ValueError("Миссия не найдена")
    if not m["done"]:
        raise ValueError("Миссия ещё не выполнена")
    if m["claimed"]:
        raise ValueError("Уже получено")
    claimed = {x["id"]: True for x in data["missions"] if x["claimed"]}
    claimed[mission_id] = True
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE shift_missions SET claimed = ? WHERE user_id = ? AND chat_id = ? AND day_key = ?",
            (json.dumps(claimed), user_id, chat_id, data["day"]),
        )
        await db.commit()
    bal = await core_db.add_coins(user_id, chat_id, m["reward_coins"])
    await add_wallet_tx(user_id, chat_id, m["reward_coins"], "mission", mission_id)
    prof = await get_or_create_profile(user_id, chat_id)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE shift_profiles SET sea_xp = sea_xp + ? WHERE user_id = ? AND chat_id = ?",
            (m["reward_xp"], user_id, chat_id),
        )
        await db.commit()
    await push_notification(user_id, chat_id, "Mission Complete", m["title"], "mission")
    return {"balance": bal, "reward_coins": m["reward_coins"], "reward_xp": m["reward_xp"]}


async def claim_daily(user_id: int, chat_id: int) -> dict:
    import db as core_db

    prof = await get_or_create_profile(user_id, chat_id)
    now = time.time()
    last = float(prof.get("daily_claim") or 0)
    if now - last < 20 * 3600:
        raise ValueError("Ежедневная награда уже получена")
    reward = 50
    bal = await core_db.add_coins(user_id, chat_id, reward)
    await add_wallet_tx(user_id, chat_id, reward, "daily", "daily_reward")
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE shift_profiles SET daily_claim = ? WHERE user_id = ? AND chat_id = ?",
            (now, user_id, chat_id),
        )
        await db.commit()
    await push_notification(user_id, chat_id, "Daily Reward", f"+{reward} S-Coins", "reward")
    return {"balance": bal, "reward": reward}


async def push_notification(user_id: int, chat_id: int, title: str, body: str, kind: str = "info") -> None:
    await ensure_eco_tables()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            INSERT INTO shift_notifications (user_id, chat_id, title, body, kind, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (user_id, chat_id, title, body, kind, time.time()),
        )
        await db.commit()


async def list_notifications(user_id: int, chat_id: int, limit: int = 40) -> list[dict]:
    await ensure_eco_tables()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM shift_notifications WHERE user_id = ? AND chat_id = ? ORDER BY id DESC LIMIT ?",
            (user_id, chat_id, limit),
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]


async def add_friend(user_id: int, chat_id: int, friend_id: int) -> None:
    if user_id == friend_id:
        raise ValueError("Нельзя добавить себя")
    await ensure_eco_tables()
    now = time.time()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            INSERT INTO shift_friends (user_id, chat_id, friend_id, status, created_at)
            VALUES (?, ?, ?, 'accepted', ?)
            ON CONFLICT(user_id, chat_id, friend_id) DO UPDATE SET status = 'accepted'
            """,
            (user_id, chat_id, friend_id, now),
        )
        await db.execute(
            """
            INSERT INTO shift_friends (user_id, chat_id, friend_id, status, created_at)
            VALUES (?, ?, ?, 'accepted', ?)
            ON CONFLICT(user_id, chat_id, friend_id) DO UPDATE SET status = 'accepted'
            """,
            (friend_id, chat_id, user_id, now),
        )
        await db.commit()
    await push_notification(friend_id, chat_id, "New Friend", "You are now friends in Shift", "friend")


async def list_friends(user_id: int, chat_id: int) -> list[dict]:
    import db as core_db

    await ensure_eco_tables()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT friend_id FROM shift_friends WHERE user_id = ? AND chat_id = ? AND status = 'accepted'",
            (user_id, chat_id),
        ) as cur:
            ids = [r[0] for r in await cur.fetchall()]
    out = []
    for fid in ids:
        u = await core_db.get_user(fid, chat_id)
        p = await get_or_create_profile(fid, chat_id)
        out.append({
            "user_id": fid,
            "name": (u or {}).get("first_name") or f"Player {fid}",
            "level": (u or {}).get("level") or 1,
            "rating": p.get("rating") or 1000,
            "league": league_for(int(p.get("rating") or 1000))["league"],
        })
    return out


async def create_challenge(from_id: int, to_id: int, chat_id: int, stake: int, code: str) -> dict:
    await ensure_eco_tables()
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            """
            INSERT INTO shift_challenges (from_id, to_id, chat_id, stake, status, room_code, created_at)
            VALUES (?, ?, ?, ?, 'pending', ?, ?)
            """,
            (from_id, to_id, chat_id, stake, code, time.time()),
        )
        await db.commit()
        cid = cur.lastrowid
    await push_notification(to_id, chat_id, "⚓ Shift Sea Battle", f"Challenge · {stake} S", "challenge")
    return {"id": cid, "code": code, "stake": stake}


async def list_challenges(user_id: int, chat_id: int) -> list[dict]:
    await ensure_eco_tables()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT * FROM shift_challenges
            WHERE chat_id = ? AND status = 'pending' AND (to_id = ? OR from_id = ?)
            ORDER BY id DESC LIMIT 20
            """,
            (chat_id, user_id, user_id),
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]


async def respond_challenge(challenge_id: int, user_id: int, accept: bool) -> dict:
    await ensure_eco_tables()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM shift_challenges WHERE id = ?", (challenge_id,)) as cur:
            row = await cur.fetchone()
            if not row:
                raise ValueError("Челлендж не найден")
            ch = dict(row)
        if ch["to_id"] != user_id:
            raise ValueError("Не ваш челлендж")
        status = "accepted" if accept else "declined"
        await db.execute("UPDATE shift_challenges SET status = ? WHERE id = ?", (status, challenge_id))
        await db.commit()
    return ch


# ——— Fleet chat ———

async def post_fleet_message(clan_id: int, user_id: int, name: str, text: str, kind: str = "user") -> dict:
    await ensure_eco_tables()
    now = time.time()
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            """
            INSERT INTO fleet_messages (clan_id, user_id, name, text, kind, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (clan_id, user_id, name, text[:2000], kind, now),
        )
        await db.commit()
        mid = cur.lastrowid
    return {"id": mid, "clan_id": clan_id, "user_id": user_id, "name": name, "text": text, "kind": kind, "created_at": now}


async def list_fleet_messages(clan_id: int, limit: int = 80) -> list[dict]:
    await ensure_eco_tables()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM fleet_messages WHERE clan_id = ? ORDER BY id DESC LIMIT ?",
            (clan_id, limit),
        ) as cur:
            rows = [dict(r) for r in await cur.fetchall()]
    rows.reverse()
    return rows


async def save_replay(room_id: str, chat_id: int, stake: int, winner_id: int, payload: dict) -> None:
    await ensure_eco_tables()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            INSERT OR REPLACE INTO match_replays (room_id, chat_id, stake, winner_id, payload, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (room_id, chat_id, stake, winner_id, json.dumps(payload), time.time()),
        )
        await db.commit()


async def get_replay(room_id: str) -> dict | None:
    await ensure_eco_tables()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM match_replays WHERE room_id = ?", (room_id,)) as cur:
            row = await cur.fetchone()
            if not row:
                return None
            d = dict(row)
            d["payload"] = json.loads(d["payload"])
            return d


async def rating_leaderboard(chat_id: int, limit: int = 30) -> list[dict]:
    import db as core_db

    await ensure_eco_tables()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT p.*, u.first_name, u.username, u.level
            FROM shift_profiles p
            LEFT JOIN users u ON u.user_id = p.user_id AND u.chat_id = p.chat_id
            WHERE p.chat_id = ?
            ORDER BY p.rating DESC
            LIMIT ?
            """,
            (chat_id, limit),
        ) as cur:
            rows = [dict(r) for r in await cur.fetchall()]
    out = []
    for i, r in enumerate(rows, 1):
        rating = int(r.get("rating") or 1000)
        out.append({
            "rank": i,
            "user_id": r["user_id"],
            "name": r.get("first_name") or r.get("username") or "Игрок",
            "rating": rating,
            "league": league_for(rating)["league"],
            "streak": r.get("streak") or 0,
            "level": r.get("level") or 1,
        })
    return out
