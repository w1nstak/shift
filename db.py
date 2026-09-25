import aiosqlite
from config import DB_PATH, FOUNDER_ITEM, FOUNDER_LIMIT


async def init_db() -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript(
            """
            CREATE TABLE IF NOT EXISTS chats (
                chat_id INTEGER PRIMARY KEY,
                active INTEGER DEFAULT 0,
                welcome TEXT DEFAULT '✨ Добро пожаловать, {name}! 👋\nРады видеть тебя в чате!',
                rules TEXT DEFAULT 'Соблюдайте правила чата и уважайте участников.',
                antiflood INTEGER DEFAULT 1,
                flood_limit INTEGER DEFAULT 5
            );

            CREATE TABLE IF NOT EXISTS users (
                user_id INTEGER,
                chat_id INTEGER,
                username TEXT,
                first_name TEXT,
                coins INTEGER DEFAULT 100,
                karma INTEGER DEFAULT 0,
                warns INTEGER DEFAULT 0,
                messages INTEGER DEFAULT 0,
                xp INTEGER DEFAULT 0,
                level INTEGER DEFAULT 1,
                wins INTEGER DEFAULT 0,
                losses INTEGER DEFAULT 0,
                games_played INTEGER DEFAULT 0,
                inventory TEXT DEFAULT '{}',
                last_fish REAL DEFAULT 0,
                last_mine REAL DEFAULT 0,
                last_lottery REAL DEFAULT 0,
                last_daily_bonus REAL DEFAULT 0,
                daily_streak INTEGER DEFAULT 0,
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, chat_id)
            );

            CREATE TABLE IF NOT EXISTS mutes (
                user_id INTEGER,
                chat_id INTEGER,
                until_ts REAL,
                PRIMARY KEY (user_id, chat_id)
            );

            CREATE TABLE IF NOT EXISTS triggers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id INTEGER,
                keyword TEXT,
                response TEXT
            );

            CREATE TABLE IF NOT EXISTS clans (
                clan_id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                tag TEXT UNIQUE NOT NULL,
                owner_id INTEGER NOT NULL,
                description TEXT DEFAULT '',
                coins INTEGER DEFAULT 0,
                level INTEGER DEFAULT 1,
                xp INTEGER DEFAULT 0,
                wins INTEGER DEFAULT 0,
                losses INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS clan_members (
                user_id INTEGER NOT NULL,
                chat_id INTEGER NOT NULL,
                clan_id INTEGER NOT NULL,
                role TEXT DEFAULT 'member',
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, chat_id)
            );

            CREATE TABLE IF NOT EXISTS clan_invites (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id INTEGER NOT NULL,
                clan_id INTEGER NOT NULL,
                inviter_id INTEGER NOT NULL,
                invitee_id INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS clan_battles (
                battle_id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id INTEGER NOT NULL,
                challenger_clan_id INTEGER NOT NULL,
                defender_clan_id INTEGER NOT NULL,
                bet INTEGER DEFAULT 0,
                status TEXT DEFAULT 'pending',
                challenger_hp INTEGER DEFAULT 100,
                defender_hp INTEGER DEFAULT 100,
                turn TEXT DEFAULT 'challenger',
                winner_id INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                finished_at TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS seabattle_stats (
                user_id INTEGER NOT NULL,
                chat_id INTEGER NOT NULL,
                wins INTEGER DEFAULT 0,
                losses INTEGER DEFAULT 0,
                coins_won INTEGER DEFAULT 0,
                coins_lost INTEGER DEFAULT 0,
                shots INTEGER DEFAULT 0,
                hits INTEGER DEFAULT 0,
                best_streak INTEGER DEFAULT 0,
                streak INTEGER DEFAULT 0,
                PRIMARY KEY (user_id, chat_id)
            );

            CREATE TABLE IF NOT EXISTS seabattle_matches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                room_id TEXT,
                chat_id INTEGER,
                winner_id INTEGER,
                loser_id INTEGER,
                stake INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        await db.commit()
        await _migrate(db)


async def _migrate(db: aiosqlite.Connection) -> None:
    cols = {
        "xp": "INTEGER DEFAULT 0",
        "level": "INTEGER DEFAULT 1",
        "wins": "INTEGER DEFAULT 0",
        "losses": "INTEGER DEFAULT 0",
        "games_played": "INTEGER DEFAULT 0",
        "inventory": "TEXT DEFAULT '{}'",
        "last_fish": "REAL DEFAULT 0",
        "last_mine": "REAL DEFAULT 0",
        "last_lottery": "REAL DEFAULT 0",
        "last_daily_bonus": "REAL DEFAULT 0",
        "daily_streak": "INTEGER DEFAULT 0",
    }
    async with db.execute("PRAGMA table_info(users)") as cur:
        existing = {row[1] for row in await cur.fetchall()}
    for name, typedef in cols.items():
        if name not in existing:
            await db.execute(f"ALTER TABLE users ADD COLUMN {name} {typedef}")
    await db.commit()


async def ensure_chat(chat_id: int) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT OR IGNORE INTO chats (chat_id) VALUES (?)",
            (chat_id,),
        )
        await db.commit()


async def find_user_by_username(chat_id: int, username: str) -> dict | None:
    username = username.lstrip("@").lower()
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            """
            SELECT user_id, username, first_name
            FROM users
            WHERE chat_id = ? AND LOWER(username) = ?
            LIMIT 1
            """,
            (chat_id, username),
        ) as cur:
            row = await cur.fetchone()
            if not row:
                return None
            return {"user_id": row[0], "username": row[1], "first_name": row[2]}


async def ensure_user(user_id: int, chat_id: int, username: str | None, first_name: str | None) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            INSERT OR IGNORE INTO users (user_id, chat_id, username, first_name)
            VALUES (?, ?, ?, ?)
            """,
            (user_id, chat_id, username, first_name),
        )
        await db.execute(
            """
            UPDATE users SET username = ?, first_name = ?
            WHERE user_id = ? AND chat_id = ?
            """,
            (username, first_name, user_id, chat_id),
        )
        await db.commit()


async def register_global_user(user_id: int) -> tuple[bool, bool]:
    """Регистрация пользователя глобально. Возвращает (новый, получил брелок)."""
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT got_founder_item FROM global_users WHERE user_id = ?", (user_id,)) as cur:
            row = await cur.fetchone()
            if row:
                return False, bool(row[0])

        async with db.execute("SELECT COUNT(*) FROM global_users WHERE got_founder_item = 1") as cur:
            founders = (await cur.fetchone())[0]

        got_founder = founders < FOUNDER_LIMIT
        await db.execute(
            "INSERT INTO global_users (user_id, got_founder_item) VALUES (?, ?)",
            (user_id, 1 if got_founder else 0),
        )
        await db.commit()
        return True, got_founder


async def sync_founder_item(user_id: int, chat_id: int) -> bool:
    """Выдать брелок основателю в инвентарь чата, если ещё не выдан."""
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT got_founder_item FROM global_users WHERE user_id = ?", (user_id,)
        ) as cur:
            row = await cur.fetchone()
            if not row or not row[0]:
                return False

    inv = await get_inventory(user_id, chat_id)
    if inv.get(FOUNDER_ITEM, 0) > 0:
        return False

    await set_inventory_item(user_id, chat_id, FOUNDER_ITEM, 1)
    return True


async def founders_remaining() -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT COUNT(*) FROM global_users WHERE got_founder_item = 1"
        ) as cur:
            count = (await cur.fetchone())[0]
    return max(0, FOUNDER_LIMIT - count)


async def get_chat(chat_id: int) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM chats WHERE chat_id = ?", (chat_id,)) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


async def set_chat_active(chat_id: int, active: bool) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE chats SET active = ? WHERE chat_id = ?",
            (1 if active else 0, chat_id),
        )
        await db.commit()


async def get_user(user_id: int, chat_id: int) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM users WHERE user_id = ? AND chat_id = ?",
            (user_id, chat_id),
        ) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


async def inc_messages(user_id: int, chat_id: int) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE users SET messages = messages + 1 WHERE user_id = ? AND chat_id = ?",
            (user_id, chat_id),
        )
        await db.commit()


async def add_coins(user_id: int, chat_id: int, amount: int) -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE users SET coins = coins + ? WHERE user_id = ? AND chat_id = ?",
            (amount, user_id, chat_id),
        )
        await db.commit()
    user = await get_user(user_id, chat_id)
    return user["coins"] if user else 0


async def add_karma(user_id: int, chat_id: int, amount: int) -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE users SET karma = karma + ? WHERE user_id = ? AND chat_id = ?",
            (amount, user_id, chat_id),
        )
        await db.commit()
    user = await get_user(user_id, chat_id)
    return user["karma"] if user else 0


async def add_warn(user_id: int, chat_id: int) -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE users SET warns = warns + 1 WHERE user_id = ? AND chat_id = ?",
            (user_id, chat_id),
        )
        await db.commit()
    user = await get_user(user_id, chat_id)
    return user["warns"] if user else 0


async def reset_warns(user_id: int, chat_id: int) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE users SET warns = 0 WHERE user_id = ? AND chat_id = ?",
            (user_id, chat_id),
        )
        await db.commit()


async def set_mute(user_id: int, chat_id: int, until_ts: float) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            INSERT INTO mutes (user_id, chat_id, until_ts) VALUES (?, ?, ?)
            ON CONFLICT(user_id, chat_id) DO UPDATE SET until_ts = excluded.until_ts
            """,
            (user_id, chat_id, until_ts),
        )
        await db.commit()


async def clear_mute(user_id: int, chat_id: int) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "DELETE FROM mutes WHERE user_id = ? AND chat_id = ?",
            (user_id, chat_id),
        )
        await db.commit()


async def get_mute_until(user_id: int, chat_id: int) -> float | None:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT until_ts FROM mutes WHERE user_id = ? AND chat_id = ?",
            (user_id, chat_id),
        ) as cur:
            row = await cur.fetchone()
            return row[0] if row else None


async def add_xp(user_id: int, chat_id: int, amount: int) -> dict:
    user = await get_user(user_id, chat_id)
    if not user:
        return {"level": 1, "xp": 0, "level_up": False}
    xp = user.get("xp", 0) + amount
    level = user.get("level", 1)
    level_up = False
    while xp >= level * 100:
        xp -= level * 100
        level += 1
        level_up = True
        await add_coins(user_id, chat_id, level * 10)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE users SET xp = ?, level = ? WHERE user_id = ? AND chat_id = ?",
            (xp, level, user_id, chat_id),
        )
        await db.commit()
    return {"level": level, "xp": xp, "level_up": level_up}


async def get_level_info(user_id: int, chat_id: int) -> dict:
    user = await get_user(user_id, chat_id)
    if not user:
        return {"level": 1, "xp": 0, "level_up": False}
    return {"level": user.get("level", 1), "xp": user.get("xp", 0), "level_up": False}


async def get_last_daily_bonus(user_id: int, chat_id: int) -> float:
    user = await get_user(user_id, chat_id)
    if not user:
        return 0.0
    return float(user.get("last_daily_bonus") or 0.0)


async def set_last_daily_bonus(user_id: int, chat_id: int, ts: float) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE users SET last_daily_bonus = ? WHERE user_id = ? AND chat_id = ?",
            (ts, user_id, chat_id),
        )
        await db.commit()


async def get_daily_streak(user_id: int, chat_id: int) -> int:
    user = await get_user(user_id, chat_id)
    if not user:
        return 0
    return int(user.get("daily_streak") or 0)


async def set_daily_streak(user_id: int, chat_id: int, streak: int) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE users SET daily_streak = ? WHERE user_id = ? AND chat_id = ?",
            (max(0, streak), user_id, chat_id),
        )
        await db.commit()


async def record_game(user_id: int, chat_id: int, won: bool) -> None:
    col = "wins" if won else "losses"
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            f"UPDATE users SET {col} = {col} + 1, games_played = games_played + 1 "
            "WHERE user_id = ? AND chat_id = ?",
            (user_id, chat_id),
        )
        await db.commit()


async def record_seabattle_result(
    user_id: int,
    chat_id: int,
    won: bool,
    stake: int,
    shots: int,
    hits: int,
) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            INSERT INTO seabattle_stats (user_id, chat_id, wins, losses, coins_won, coins_lost, shots, hits, best_streak, streak)
            VALUES (?, ?, 0, 0, 0, 0, 0, 0, 0, 0)
            ON CONFLICT(user_id, chat_id) DO NOTHING
            """,
            (user_id, chat_id),
        )
        if won:
            await db.execute(
                """
                UPDATE seabattle_stats SET
                    wins = wins + 1,
                    coins_won = coins_won + ?,
                    shots = shots + ?,
                    hits = hits + ?,
                    streak = streak + 1,
                    best_streak = CASE WHEN streak + 1 > best_streak THEN streak + 1 ELSE best_streak END
                WHERE user_id = ? AND chat_id = ?
                """,
                (stake * 2, shots, hits, user_id, chat_id),
            )
        else:
            await db.execute(
                """
                UPDATE seabattle_stats SET
                    losses = losses + 1,
                    coins_lost = coins_lost + ?,
                    shots = shots + ?,
                    hits = hits + ?,
                    streak = 0
                WHERE user_id = ? AND chat_id = ?
                """,
                (stake, shots, hits, user_id, chat_id),
            )
        await db.commit()


async def get_seabattle_stats(user_id: int, chat_id: int) -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM seabattle_stats WHERE user_id = ? AND chat_id = ?",
            (user_id, chat_id),
        ) as cur:
            row = await cur.fetchone()
            if not row:
                return {
                    "wins": 0, "losses": 0, "coins_won": 0, "coins_lost": 0,
                    "shots": 0, "hits": 0, "best_streak": 0, "streak": 0,
                }
            return dict(row)


async def seabattle_leaderboard(chat_id: int, period: str = "all", limit: int = 20) -> list[dict]:
    """period: today | week | all — currently all-time from seabattle_stats."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT s.*, u.first_name, u.username, u.level
            FROM seabattle_stats s
            LEFT JOIN users u ON u.user_id = s.user_id AND u.chat_id = s.chat_id
            WHERE s.chat_id = ? AND (s.wins + s.losses) > 0
            ORDER BY s.wins DESC, s.coins_won DESC
            LIMIT ?
            """,
            (chat_id, limit),
        ) as cur:
            rows = await cur.fetchall()
            return [dict(r) for r in rows]


async def set_cooldown(user_id: int, chat_id: int, field: str, ts: float) -> None:
    allowed = {"last_fish", "last_mine", "last_lottery"}
    if field not in allowed:
        return
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            f"UPDATE users SET {field} = ? WHERE user_id = ? AND chat_id = ?",
            (ts, user_id, chat_id),
        )
        await db.commit()


async def get_inventory(user_id: int, chat_id: int) -> dict:
    import json
    user = await get_user(user_id, chat_id)
    if not user:
        return {}
    try:
        return json.loads(user.get("inventory") or "{}")
    except json.JSONDecodeError:
        return {}


async def set_inventory_item(user_id: int, chat_id: int, item: str, count: int) -> None:
    import json
    inv = await get_inventory(user_id, chat_id)
    if count <= 0:
        inv.pop(item, None)
    else:
        inv[item] = count
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE users SET inventory = ? WHERE user_id = ? AND chat_id = ?",
            (json.dumps(inv, ensure_ascii=False), user_id, chat_id),
        )
        await db.commit()


async def top_users(chat_id: int, field: str, limit: int = 10) -> list[dict]:
    allowed = {"coins", "karma", "messages", "wins", "level", "xp"}
    if field not in allowed:
        field = "messages"
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            f"""
            SELECT user_id, username, first_name, {field} AS score
            FROM users WHERE chat_id = ?
            ORDER BY {field} DESC LIMIT ?
            """,
            (chat_id, limit),
        ) as cur:
            rows = await cur.fetchall()
            return [dict(r) for r in rows]


async def add_trigger(chat_id: int, keyword: str, response: str) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO triggers (chat_id, keyword, response) VALUES (?, ?, ?)",
            (chat_id, keyword.lower(), response),
        )
        await db.commit()


async def find_trigger(chat_id: int, text: str) -> str | None:
    words = text.lower().split()
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT keyword, response FROM triggers WHERE chat_id = ?",
            (chat_id,),
        ) as cur:
            rows = await cur.fetchall()
    for keyword, response in rows:
        if keyword in words or keyword in text.lower():
            return response
    return None


# ── Кланы ──────────────────────────────────────────────────────

async def create_clan(chat_id: int, name: str, tag: str, owner_id: int) -> int | None:
    tag = tag.upper()
    async with aiosqlite.connect(DB_PATH) as db:
        try:
            cur = await db.execute(
                "INSERT INTO clans (chat_id, name, tag, owner_id) VALUES (?, ?, ?, ?)",
                (chat_id, name, tag, owner_id),
            )
            clan_id = cur.lastrowid
            await db.execute(
                "INSERT INTO clan_members (user_id, chat_id, clan_id, role) VALUES (?, ?, ?, 'owner')",
                (owner_id, chat_id, clan_id),
            )
            await db.commit()
            return clan_id
        except aiosqlite.IntegrityError:
            await db.rollback()
            return None


async def get_clan_by_tag(chat_id: int, tag: str) -> dict | None:
    tag = tag.upper().lstrip("#").lstrip("[")
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM clans WHERE chat_id = ? AND tag = ?",
            (chat_id, tag),
        ) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


async def get_clan_by_id(clan_id: int) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM clans WHERE clan_id = ?", (clan_id,)) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


async def get_user_clan(user_id: int, chat_id: int) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT c.* FROM clans c
            JOIN clan_members cm ON c.clan_id = cm.clan_id
            WHERE cm.user_id = ? AND cm.chat_id = ?
            """,
            (user_id, chat_id),
        ) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


async def get_member_role(user_id: int, chat_id: int) -> str | None:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT role FROM clan_members WHERE user_id = ? AND chat_id = ?",
            (user_id, chat_id),
        ) as cur:
            row = await cur.fetchone()
            return row[0] if row else None


async def add_clan_member(user_id: int, chat_id: int, clan_id: int, role: str = "member") -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        try:
            await db.execute(
                "INSERT INTO clan_members (user_id, chat_id, clan_id, role) VALUES (?, ?, ?, ?)",
                (user_id, chat_id, clan_id, role),
            )
            await db.commit()
            return True
        except aiosqlite.IntegrityError:
            return False


async def remove_clan_member(user_id: int, chat_id: int) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "DELETE FROM clan_members WHERE user_id = ? AND chat_id = ?",
            (user_id, chat_id),
        )
        await db.commit()


async def set_member_role(user_id: int, chat_id: int, role: str) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE clan_members SET role = ? WHERE user_id = ? AND chat_id = ?",
            (role, user_id, chat_id),
        )
        await db.commit()


async def get_clan_members(clan_id: int) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT cm.*, u.username, u.first_name, u.coins, u.level
            FROM clan_members cm
            LEFT JOIN users u ON cm.user_id = u.user_id AND cm.chat_id = u.chat_id
            WHERE cm.clan_id = ?
            ORDER BY
                CASE cm.role WHEN 'owner' THEN 1 WHEN 'officer' THEN 2 ELSE 3 END,
                cm.joined_at ASC
            """,
            (clan_id,),
        ) as cur:
            rows = await cur.fetchall()
            return [dict(r) for r in rows]


async def add_clan_invite(chat_id: int, clan_id: int, inviter_id: int, invitee_id: int) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "DELETE FROM clan_invites WHERE chat_id = ? AND invitee_id = ?",
            (chat_id, invitee_id),
        )
        await db.execute(
            "INSERT INTO clan_invites (chat_id, clan_id, inviter_id, invitee_id) VALUES (?, ?, ?, ?)",
            (chat_id, clan_id, inviter_id, invitee_id),
        )
        await db.commit()


async def get_clan_invite(invitee_id: int, chat_id: int) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM clan_invites WHERE invitee_id = ? AND chat_id = ? ORDER BY id DESC LIMIT 1",
            (invitee_id, chat_id),
        ) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


async def clear_clan_invite(invitee_id: int, chat_id: int) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "DELETE FROM clan_invites WHERE invitee_id = ? AND chat_id = ?",
            (invitee_id, chat_id),
        )
        await db.commit()


async def add_clan_coins(clan_id: int, amount: int) -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE clans SET coins = coins + ? WHERE clan_id = ?",
            (amount, clan_id),
        )
        await db.commit()
    clan = await get_clan_by_id(clan_id)
    return clan["coins"] if clan else 0


async def add_clan_xp(clan_id: int, amount: int) -> dict:
    clan = await get_clan_by_id(clan_id)
    if not clan:
        return {"level": 1, "xp": 0, "level_up": False}
    xp = clan.get("xp", 0) + amount
    level = clan.get("level", 1)
    old_level = level
    while xp >= level * 200:
        xp -= level * 200
        level += 1
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE clans SET xp = ?, level = ? WHERE clan_id = ?",
            (xp, level, clan_id),
        )
        await db.commit()
    return {"level": level, "xp": xp, "level_up": level > old_level}


async def top_clans(chat_id: int, field: str = "coins", limit: int = 10) -> list[dict]:
    allowed = {"coins", "level", "xp", "wins"}
    if field not in allowed:
        field = "coins"
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            f"""
            SELECT clan_id, name, tag, owner_id, {field} AS score
            FROM clans WHERE chat_id = ?
            ORDER BY {field} DESC LIMIT ?
            """,
            (chat_id, limit),
        ) as cur:
            rows = await cur.fetchall()
            return [dict(r) for r in rows]


async def set_clan_description(clan_id: int, description: str) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE clans SET description = ? WHERE clan_id = ?",
            (description, clan_id),
        )
        await db.commit()


async def set_clan_owner(clan_id: int, new_owner_id: int, chat_id: int) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE clans SET owner_id = ? WHERE clan_id = ?",
            (new_owner_id, clan_id),
        )
        await db.execute(
            "UPDATE clan_members SET role = 'owner' WHERE user_id = ? AND chat_id = ? AND clan_id = ?",
            (new_owner_id, chat_id, clan_id),
        )
        await db.commit()


async def delete_clan(clan_id: int) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM clan_members WHERE clan_id = ?", (clan_id,))
        await db.execute("DELETE FROM clans WHERE clan_id = ?", (clan_id,))
        await db.commit()


# ── Клановые битвы ─────────────────────────────────────────────

async def create_clan_battle(
    chat_id: int, challenger_clan_id: int, defender_clan_id: int, bet: int = 0
) -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            """
            INSERT INTO clan_battles
            (chat_id, challenger_clan_id, defender_clan_id, bet)
            VALUES (?, ?, ?, ?)
            """,
            (chat_id, challenger_clan_id, defender_clan_id, bet),
        )
        await db.commit()
        return cur.lastrowid


async def get_active_battle_for_clan(clan_id: int, chat_id: int) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT * FROM clan_battles
            WHERE chat_id = ? AND status IN ('pending', 'active')
              AND (challenger_clan_id = ? OR defender_clan_id = ?)
            ORDER BY created_at DESC LIMIT 1
            """,
            (chat_id, clan_id, clan_id),
        ) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


async def get_battle(battle_id: int) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM clan_battles WHERE battle_id = ?", (battle_id,)) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


async def accept_battle(battle_id: int) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE clan_battles SET status = 'active' WHERE battle_id = ?",
            (battle_id,),
        )
        await db.commit()


async def reject_battle(battle_id: int) -> None:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE clan_battles SET status = 'rejected', finished_at = CURRENT_TIMESTAMP WHERE battle_id = ?",
            (battle_id,),
        )
        await db.commit()


async def apply_battle_damage(battle_id: int, side: str, damage: int) -> dict:
    side_field = "challenger_hp" if side == "challenger" else "defender_hp"
    other_side = "defender" if side == "challenger" else "challenger"
    other_field = "challenger_hp" if side == "defender" else "defender_hp"
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            f"UPDATE clan_battles SET {other_field} = MAX(0, {other_field} - ?), turn = ? WHERE battle_id = ?",
            (damage, other_side, battle_id),
        )
        await db.commit()
    return await get_battle(battle_id)


async def finish_battle(battle_id: int, winner_id: int) -> None:
    battle = await get_battle(battle_id)
    if not battle:
        return
    loser_id = battle["defender_clan_id"] if winner_id == battle["challenger_clan_id"] else battle["challenger_clan_id"]
    bet = battle["bet"]
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """
            UPDATE clan_battles
            SET status = 'finished', winner_id = ?, finished_at = CURRENT_TIMESTAMP
            WHERE battle_id = ?
            """,
            (winner_id, battle_id),
        )
        await db.execute("UPDATE clans SET wins = wins + 1 WHERE clan_id = ?", (winner_id,))
        await db.execute("UPDATE clans SET losses = losses + 1 WHERE clan_id = ?", (loser_id,))
        if bet > 0:
            await db.execute("UPDATE clans SET coins = coins + ? WHERE clan_id = ?", (bet, winner_id))
            await db.execute("UPDATE clans SET coins = coins - ? WHERE clan_id = ?", (bet, loser_id))
        await db.commit()
    await add_clan_xp(winner_id, 50)
    await add_clan_xp(loser_id, 10)
