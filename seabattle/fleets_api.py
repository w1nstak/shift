"""Shift Fleets + social API routes."""
from __future__ import annotations

import re

from aiohttp import web

import db
from config import MINI_APP_URL, SEA_BATTLE_STAKES
from seabattle import eco
from seabattle.engine import engine


def resolve_player(request: web.Request):
    from seabattle.server import resolve_player as rp
    return rp(request)


def _tag_ok(tag: str) -> bool:
    return bool(re.fullmatch(r"[A-Za-z0-9]{2,5}", tag or ""))


async def eco_home(request: web.Request) -> web.Response:
    user_id, chat_id, meta = resolve_player(request)
    await db.ensure_user(user_id, chat_id, meta.get("username"), meta["name"])
    user = await db.get_user(user_id, chat_id)
    prof = await eco.get_or_create_profile(user_id, chat_id)
    clan = await db.get_user_clan(user_id, chat_id)
    missions = await eco.get_missions(user_id, chat_id)
    notifs = await eco.list_notifications(user_id, chat_id, limit=12)
    fleet_chat = None
    if clan:
        members = await db.get_clan_members(clan["clan_id"])
        msgs = await eco.list_fleet_messages(clan["clan_id"], limit=1)
        last = msgs[-1] if msgs else None
        fleet_chat = {
            "clan_id": clan["clan_id"],
            "name": clan["name"],
            "tag": clan["tag"],
            "members": len(members),
            "level": clan.get("level") or 1,
            "preview": (last["text"] if last else "Fleet chat ready"),
            "chat_id": f"fleet-{clan['clan_id']}",
        }
    rating = int(prof.get("rating") or 1000)
    return web.json_response({
        "ok": True,
        "user": {
            "user_id": user_id,
            "name": meta["name"],
            "photo_url": meta.get("photo_url") or "",
            "coins": int(user["coins"]) if user else 0,
            "level": int(user.get("level") or 1) if user else 1,
        },
        "profile": {
            **prof,
            "cosmetics": __import__("json").loads(prof.get("cosmetics") or "{}"),
            **eco.league_for(rating),
        },
        "fleet": clan,
        "fleet_chat": fleet_chat,
        "missions": missions,
        "notifications": notifs,
        "arenas": list(eco.ARENAS),
        "cosmetics_shop": list(eco.COSMETICS),
        "season": {
            "name": "SHIFT SEASON 01",
            "level": int(prof.get("season_level") or 1),
            "xp": int(prof.get("season_xp") or 0),
            "xp_need": 100,
        },
        "stakes": list(SEA_BATTLE_STAKES),
    })


async def create_fleet(request: web.Request) -> web.Response:
    user_id, chat_id, meta = resolve_player(request)
    body = await request.json()
    name = (body.get("name") or "").strip()[:32]
    tag = (body.get("tag") or "").strip().upper()
    desc = (body.get("description") or "").strip()[:200]
    if len(name) < 2:
        return web.json_response({"ok": False, "error": "Имя флота слишком короткое"}, status=400)
    if not _tag_ok(tag):
        return web.json_response({"ok": False, "error": "Тег: 2–5 латиница/цифры"}, status=400)
    existing = await db.get_user_clan(user_id, chat_id)
    if existing:
        return web.json_response({"ok": False, "error": "Вы уже во флоте"}, status=400)
    await db.ensure_user(user_id, chat_id, meta.get("username"), meta["name"])
    clan_id = await db.create_clan(chat_id, name, tag, user_id)
    if not clan_id:
        return web.json_response({"ok": False, "error": "Тег занят"}, status=400)
    if desc:
        try:
            await db.set_clan_description(clan_id, desc)
        except Exception:
            pass
    await eco.post_fleet_message(clan_id, 0, "Shift", "Your fleet has been created.", "system")
    await eco.post_fleet_message(clan_id, user_id, meta["name"], f"{meta['name']} founded the fleet.", "system")
    await eco.push_notification(user_id, chat_id, "Fleet Created", f"⚓ {name} is ready", "fleet")
    clan = await db.get_clan_by_id(clan_id)
    members = await db.get_clan_members(clan_id)
    return web.json_response({
        "ok": True,
        "message": "Fleet Created",
        "fleet": clan,
        "fleet_chat": {
            "clan_id": clan_id,
            "name": name,
            "tag": tag,
            "members": len(members),
            "level": 1,
            "preview": "Your fleet has been created.",
            "chat_id": f"fleet-{clan_id}",
        },
    })


async def join_fleet(request: web.Request) -> web.Response:
    user_id, chat_id, meta = resolve_player(request)
    body = await request.json()
    tag = (body.get("tag") or "").strip().upper()
    clan = await db.get_clan_by_tag(chat_id, tag)
    if not clan:
        return web.json_response({"ok": False, "error": "Флот не найден"}, status=404)
    cur = await db.get_user_clan(user_id, chat_id)
    if cur:
        return web.json_response({"ok": False, "error": "Сначала покиньте текущий флот"}, status=400)
    ok = await db.add_clan_member(user_id, chat_id, clan["clan_id"], "member")
    if not ok:
        return web.json_response({"ok": False, "error": "Не удалось вступить"}, status=400)
    await eco.post_fleet_message(clan["clan_id"], user_id, meta["name"], f"{meta['name']} joined the fleet.", "system")
    await eco.push_notification(user_id, chat_id, "Welcome to the Fleet", f"⚓ [{clan['tag']}] {clan['name']}", "fleet")
    members = await db.get_clan_members(clan["clan_id"])
    return web.json_response({
        "ok": True,
        "message": "Welcome to the Fleet",
        "fleet": clan,
        "fleet_chat": {
            "clan_id": clan["clan_id"],
            "name": clan["name"],
            "tag": clan["tag"],
            "members": len(members),
            "level": clan.get("level") or 1,
            "preview": f"{meta['name']} joined the fleet.",
            "chat_id": f"fleet-{clan['clan_id']}",
        },
    })


async def leave_fleet(request: web.Request) -> web.Response:
    user_id, chat_id, meta = resolve_player(request)
    clan = await db.get_user_clan(user_id, chat_id)
    if not clan:
        return web.json_response({"ok": False, "error": "Нет флота"}, status=400)
    role = await db.get_member_role(user_id, chat_id)
    if role == "owner":
        return web.json_response({"ok": False, "error": "Владелец: передайте флот или удалите через бота"}, status=400)
    await eco.post_fleet_message(clan["clan_id"], user_id, meta["name"], f"{meta['name']} left the fleet.", "system")
    await db.remove_clan_member(user_id, chat_id)
    return web.json_response({"ok": True, "message": "Left fleet"})


async def fleet_profile(request: web.Request) -> web.Response:
    user_id, chat_id, _ = resolve_player(request)
    clan = await db.get_user_clan(user_id, chat_id)
    if not clan:
        return web.json_response({"ok": True, "fleet": None})
    members = await db.get_clan_members(clan["clan_id"])
    wins = int(clan.get("wins") or 0)
    losses = int(clan.get("losses") or 0)
    total = wins + losses
    return web.json_response({
        "ok": True,
        "fleet": {
            **clan,
            "members_count": len(members),
            "members": [
                {
                    "user_id": m["user_id"],
                    "name": m.get("first_name") or m.get("username") or str(m["user_id"]),
                    "role": m.get("role") or "member",
                    "level": m.get("level") or 1,
                }
                for m in members
            ],
            "win_rate": round(wins / total * 100) if total else 0,
            "missions": [
                {"id": "c_win20", "title": "WIN 20 BATTLES", "current": min(wins, 20), "target": 20},
                {"id": "c_play50", "title": "PLAY 50 MATCHES", "current": min(wins + losses, 50), "target": 50},
            ],
        },
    })


async def fleet_messages(request: web.Request) -> web.Response:
    user_id, chat_id, _ = resolve_player(request)
    clan = await db.get_user_clan(user_id, chat_id)
    if not clan:
        return web.json_response({"ok": False, "error": "Нет флота"}, status=400)
    msgs = await eco.list_fleet_messages(clan["clan_id"])
    return web.json_response({"ok": True, "clan_id": clan["clan_id"], "messages": msgs})


async def fleet_send(request: web.Request) -> web.Response:
    user_id, chat_id, meta = resolve_player(request)
    body = await request.json()
    text = (body.get("text") or "").strip()
    if not text:
        return web.json_response({"ok": False, "error": "Пустое сообщение"}, status=400)
    clan = await db.get_user_clan(user_id, chat_id)
    if not clan:
        return web.json_response({"ok": False, "error": "Нет флота"}, status=400)
    msg = await eco.post_fleet_message(clan["clan_id"], user_id, meta["name"], text, "user")
    return web.json_response({"ok": True, "message": msg})


async def friends_list(request: web.Request) -> web.Response:
    user_id, chat_id, _ = resolve_player(request)
    rows = await eco.list_friends(user_id, chat_id)
    return web.json_response({"ok": True, "friends": rows})


async def friends_add(request: web.Request) -> web.Response:
    user_id, chat_id, _ = resolve_player(request)
    body = await request.json()
    try:
        await eco.add_friend(user_id, chat_id, int(body.get("friend_id")))
        return web.json_response({"ok": True})
    except ValueError as e:
        return web.json_response({"ok": False, "error": str(e)}, status=400)


async def challenge_create(request: web.Request) -> web.Response:
    user_id, chat_id, meta = resolve_player(request)
    body = await request.json()
    to_id = int(body.get("to_id") or 0)
    stake = int(body.get("stake") or 100)
    if stake not in SEA_BATTLE_STAKES:
        return web.json_response({"ok": False, "error": "Неверная ставка"}, status=400)
    room = await engine.create_private(user_id, chat_id, stake, meta)
    ch = await eco.create_challenge(user_id, to_id, chat_id, stake, room.invite_code or "")
    base = (MINI_APP_URL or "").rstrip("/")
    link = f"{base}?sea_invite={room.invite_code}&stake={stake}"
    return web.json_response({
        "ok": True,
        "challenge": ch,
        "invite_code": room.invite_code,
        "link": link,
        "card": {
            "title": "⚓ SHIFT SEA BATTLE",
            "text": f"{meta['name']} challenged you.",
            "entry": stake,
            "code": room.invite_code,
        },
    })


async def challenges_list(request: web.Request) -> web.Response:
    user_id, chat_id, _ = resolve_player(request)
    rows = await eco.list_challenges(user_id, chat_id)
    return web.json_response({"ok": True, "challenges": rows})


async def challenge_respond(request: web.Request) -> web.Response:
    user_id, chat_id, meta = resolve_player(request)
    body = await request.json()
    try:
        ch = await eco.respond_challenge(int(body["id"]), user_id, bool(body.get("accept")))
        if body.get("accept") and ch.get("room_code"):
            room = await engine.join_invite(user_id, chat_id, ch["room_code"], meta)
            return web.json_response({"ok": True, "accepted": True, "room": engine.public_room(room, user_id)})
        return web.json_response({"ok": True, "accepted": False})
    except ValueError as e:
        return web.json_response({"ok": False, "error": str(e)}, status=400)


async def missions_get(request: web.Request) -> web.Response:
    user_id, chat_id, _ = resolve_player(request)
    data = await eco.get_missions(user_id, chat_id)
    return web.json_response({"ok": True, **data})


async def missions_claim(request: web.Request) -> web.Response:
    user_id, chat_id, _ = resolve_player(request)
    body = await request.json()
    try:
        res = await eco.claim_mission(user_id, chat_id, body.get("id"))
        return web.json_response({"ok": True, **res})
    except ValueError as e:
        return web.json_response({"ok": False, "error": str(e)}, status=400)


async def daily_claim(request: web.Request) -> web.Response:
    user_id, chat_id, _ = resolve_player(request)
    try:
        res = await eco.claim_daily(user_id, chat_id)
        return web.json_response({"ok": True, **res})
    except ValueError as e:
        return web.json_response({"ok": False, "error": str(e)}, status=400)


async def wallet_history(request: web.Request) -> web.Response:
    user_id, chat_id, _ = resolve_player(request)
    rows = await eco.list_wallet_tx(user_id, chat_id)
    return web.json_response({"ok": True, "transactions": rows})


async def rating_board(request: web.Request) -> web.Response:
    _, chat_id, _ = resolve_player(request)
    rows = await eco.rating_leaderboard(chat_id)
    return web.json_response({"ok": True, "rows": rows})


async def set_arena(request: web.Request) -> web.Response:
    user_id, chat_id, _ = resolve_player(request)
    body = await request.json()
    arena = body.get("arena") or "pacific"
    if arena not in eco.ARENAS:
        return web.json_response({"ok": False, "error": "Unknown arena"}, status=400)
    await eco.get_or_create_profile(user_id, chat_id)
    import aiosqlite
    from config import DB_PATH
    async with aiosqlite.connect(DB_PATH) as conn:
        await conn.execute(
            "UPDATE shift_profiles SET arena = ? WHERE user_id = ? AND chat_id = ?",
            (arena, user_id, chat_id),
        )
        await conn.commit()
    return web.json_response({"ok": True, "arena": arena})


async def notifications(request: web.Request) -> web.Response:
    user_id, chat_id, _ = resolve_player(request)
    rows = await eco.list_notifications(user_id, chat_id)
    return web.json_response({"ok": True, "notifications": rows})


def register_eco_routes(app: web.Application) -> None:
    app.router.add_get("/api/shift/home", eco_home)
    app.router.add_post("/api/fleets/create", create_fleet)
    app.router.add_post("/api/fleets/join", join_fleet)
    app.router.add_post("/api/fleets/leave", leave_fleet)
    app.router.add_get("/api/fleets/me", fleet_profile)
    app.router.add_get("/api/fleets/messages", fleet_messages)
    app.router.add_post("/api/fleets/send", fleet_send)
    app.router.add_get("/api/friends", friends_list)
    app.router.add_post("/api/friends/add", friends_add)
    app.router.add_post("/api/challenges", challenge_create)
    app.router.add_get("/api/challenges", challenges_list)
    app.router.add_post("/api/challenges/respond", challenge_respond)
    app.router.add_get("/api/missions", missions_get)
    app.router.add_post("/api/missions/claim", missions_claim)
    app.router.add_post("/api/daily", daily_claim)
    app.router.add_get("/api/wallet", wallet_history)
    app.router.add_get("/api/rating", rating_board)
    app.router.add_post("/api/arena", set_arena)
    app.router.add_get("/api/notifications", notifications)
