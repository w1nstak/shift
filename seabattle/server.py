"""aiohttp REST + WebSocket API for Shift Sea Battle."""
from __future__ import annotations

import json
import logging
from typing import Any

from aiohttp import web

import db
from config import BOT_TOKEN, GAME_API_DEV, GAME_API_HOST, GAME_API_PORT, SEA_BATTLE_STAKES
from seabattle.auth import verify_webapp_init_data
from seabattle.engine import engine
from seabattle import logic

log = logging.getLogger("shift.seabattle.api")


def _cors_headers() -> dict:
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Telegram-Init-Data, X-Shift-User, X-Shift-Chat, X-Shift-Name, X-Shift-Level, X-Shift-Photo",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    }


@web.middleware
async def cors_middleware(request: web.Request, handler):
    if request.method == "OPTIONS":
        return web.Response(status=204, headers=_cors_headers())
    try:
        resp = await handler(request)
    except web.HTTPException as e:
        e.headers.update(_cors_headers())
        raise
    except Exception as e:
        log.exception("api error")
        resp = web.json_response({"ok": False, "error": str(e)}, status=500)
    if isinstance(resp, web.StreamResponse):
        for k, v in _cors_headers().items():
            resp.headers[k] = v
    return resp


def resolve_player(request: web.Request) -> tuple[int, int, dict]:
    """Return (user_id, chat_id, meta)."""
    init_data = (
        request.headers.get("X-Telegram-Init-Data")
        or request.rel_url.query.get("initData")
        or ""
    )
    # WS body may pass later; also accept JSON body initData for REST rarely
    verified = verify_webapp_init_data(init_data, BOT_TOKEN) if init_data else None

    if verified and verified.get("user"):
        u = verified["user"]
        user_id = int(u["id"])
        first = (u.get("first_name") or "").strip()
        last = (u.get("last_name") or "").strip()
        name = (first + (" " + last if last else "")).strip() or "Игрок"
        chat_id = int(request.headers.get("X-Shift-Chat") or request.rel_url.query.get("chat_id") or user_id)
        level = int(request.headers.get("X-Shift-Level") or request.rel_url.query.get("level") or 1)
        photo_url = (
            u.get("photo_url")
            or request.headers.get("X-Shift-Photo")
            or request.rel_url.query.get("photo_url")
            or ""
        )
        return user_id, chat_id, {
            "name": name,
            "level": level,
            "photo_url": photo_url,
            "avatar": (first[:1] + (last[:1] if last else "")).upper() or name[:1].upper(),
            "username": u.get("username") or "",
        }

    if GAME_API_DEV:
        user_id = int(request.headers.get("X-Shift-User") or request.rel_url.query.get("user_id") or 0)
        chat_id = int(request.headers.get("X-Shift-Chat") or request.rel_url.query.get("chat_id") or user_id)
        name = request.headers.get("X-Shift-Name") or request.rel_url.query.get("name") or "Dev Player"
        level = int(request.headers.get("X-Shift-Level") or request.rel_url.query.get("level") or 1)
        photo_url = request.headers.get("X-Shift-Photo") or request.rel_url.query.get("photo_url") or ""
        if user_id:
            return user_id, chat_id, {"name": name, "level": level, "photo_url": photo_url, "avatar": name[:1].upper()}

    raise web.HTTPUnauthorized(text=json.dumps({"ok": False, "error": "Unauthorized"}), content_type="application/json")


async def health(_: web.Request) -> web.Response:
    return web.json_response({"ok": True, "service": "shift-sea-battle", "stakes": list(SEA_BATTLE_STAKES)})


async def me(request: web.Request) -> web.Response:
    user_id, chat_id, meta = resolve_player(request)
    await db.ensure_user(user_id, chat_id, None, meta["name"])
    user = await db.get_user(user_id, chat_id)
    stats = await db.get_seabattle_stats(user_id, chat_id)
    return web.json_response({
        "ok": True,
        "user": {
            "user_id": user_id,
            "chat_id": chat_id,
            "name": meta["name"],
            "level": int(user.get("level") or meta["level"]),
            "coins": int(user.get("coins") or 0),
            "avatar": meta.get("avatar") or meta["name"][:1].upper(),
            "photo_url": meta.get("photo_url") or "",
            "username": meta.get("username") or "",
        },
        "stats": stats,
        "fleet": [{"id": sid, "name": name, "length": length} for sid, name, length in logic.FLEET],
        "stakes": list(SEA_BATTLE_STAKES),
    })


async def leaderboard(request: web.Request) -> web.Response:
    user_id, chat_id, _ = resolve_player(request)
    period = request.rel_url.query.get("period") or "all"
    rows = await db.seabattle_leaderboard(chat_id, period=period)
    out = []
    for i, r in enumerate(rows, 1):
        wins = int(r.get("wins") or 0)
        losses = int(r.get("losses") or 0)
        total = wins + losses
        out.append({
            "rank": i,
            "user_id": r["user_id"],
            "name": r.get("first_name") or r.get("username") or "Игрок",
            "level": int(r.get("level") or 1),
            "wins": wins,
            "losses": losses,
            "win_rate": round(wins / total * 100) if total else 0,
            "coins_won": int(r.get("coins_won") or 0),
        })
    return web.json_response({"ok": True, "period": period, "rows": out})


async def quick_match(request: web.Request) -> web.Response:
    user_id, chat_id, meta = resolve_player(request)
    body = await request.json()
    stake = int(body.get("stake") or 0)
    try:
        result = await engine.enqueue_quick(user_id, chat_id, stake, meta)
        return web.json_response({"ok": True, **result})
    except ValueError as e:
        return web.json_response({"ok": False, "error": str(e)}, status=400)


async def cancel_search(request: web.Request) -> web.Response:
    user_id, _, _ = resolve_player(request)
    await engine.cancel_search(user_id)
    return web.json_response({"ok": True})


async def match_status(request: web.Request) -> web.Response:
    user_id, _, _ = resolve_player(request)
    rid = engine.user_room.get(user_id)
    if rid and not str(rid).startswith("queue:"):
        room = engine.rooms.get(rid)
        if room:
            return web.json_response({
                "ok": True,
                "status": "matched",
                "room": engine.public_room(room, user_id),
            })
    if rid and str(rid).startswith("queue:"):
        return web.json_response({"ok": True, "status": "searching", "stake": int(str(rid).split(":")[1])})
    return web.json_response({"ok": True, "status": "idle"})


async def create_private(request: web.Request) -> web.Response:
    user_id, chat_id, meta = resolve_player(request)
    body = await request.json()
    stake = int(body.get("stake") or 0)
    try:
        await engine._ensure_balance(user_id, chat_id, stake)
        room = await engine.create_private(user_id, chat_id, stake, meta)
        return web.json_response({"ok": True, "room": engine.public_room(room, user_id)})
    except ValueError as e:
        return web.json_response({"ok": False, "error": str(e)}, status=400)


async def join_private(request: web.Request) -> web.Response:
    user_id, chat_id, meta = resolve_player(request)
    body = await request.json()
    code = body.get("code") or ""
    try:
        room = await engine.join_invite(user_id, chat_id, code, meta)
        return web.json_response({"ok": True, "room": engine.public_room(room, user_id)})
    except ValueError as e:
        return web.json_response({"ok": False, "error": str(e)}, status=400)


async def practice(request: web.Request) -> web.Response:
    user_id, chat_id, meta = resolve_player(request)
    body = await request.json()
    stake = int(body.get("stake") or 10)
    try:
        room = await engine.start_practice(user_id, chat_id, stake, meta)
        return web.json_response({"ok": True, "room": engine.public_room(room, user_id), "vs_bot": True})
    except ValueError as e:
        return web.json_response({"ok": False, "error": str(e)}, status=400)


async def place(request: web.Request) -> web.Response:
    user_id, _, _ = resolve_player(request)
    body = await request.json()
    room_id = body.get("room_id")
    ships = body.get("ships")
    try:
        room = await engine.place_ships(room_id, user_id, ships)
        return web.json_response({"ok": True, "room": engine.public_room(room, user_id)})
    except ValueError as e:
        return web.json_response({"ok": False, "error": str(e)}, status=400)


async def shoot(request: web.Request) -> web.Response:
    user_id, chat_id, _ = resolve_player(request)
    body = await request.json()
    try:
        payload = await engine.shoot(body.get("room_id"), user_id, int(body["r"]), int(body["c"]))
        user = await db.get_user(user_id, chat_id)
        return web.json_response({"ok": True, **payload, "balance": int(user["coins"]) if user else None})
    except ValueError as e:
        return web.json_response({"ok": False, "error": str(e)}, status=400)
    except KeyError:
        return web.json_response({"ok": False, "error": "Нужны r и c"}, status=400)


async def room_state(request: web.Request) -> web.Response:
    user_id, chat_id, _ = resolve_player(request)
    room_id = request.match_info["room_id"]
    room = engine.rooms.get(room_id)
    if not room or user_id not in room.players:
        return web.json_response({"ok": False, "error": "Не найдено"}, status=404)
    user = await db.get_user(user_id, chat_id)
    data = engine.public_room(room, user_id)
    data["balance"] = int(user["coins"]) if user else 0
    return web.json_response({"ok": True, "room": data})


async def ws_handler(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse(heartbeat=25)
    await ws.prepare(request)

    try:
        user_id, chat_id, meta = resolve_player(request)
    except web.HTTPUnauthorized:
        await ws.send_json({"type": "error", "error": "Unauthorized"})
        await ws.close()
        return ws

    room_id = request.rel_url.query.get("room_id")
    if room_id:
        await engine.reconnect(user_id, room_id)

    async def push(event: dict) -> None:
        if not ws.closed:
            # re-scope room for this viewer when present
            if event.get("room") and room_id and room_id in engine.rooms:
                event = {**event, "room": engine.public_room(engine.rooms[room_id], user_id)}
            await ws.send_json(event)

    if room_id:
        engine.subscribe(room_id, push)
        room = engine.rooms.get(room_id)
        if room:
            await ws.send_json({"type": "state", "room": engine.public_room(room, user_id)})

    try:
        async for msg in ws:
            if msg.type == web.WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                except Exception:
                    continue
                typ = data.get("type")
                if typ == "ping":
                    await ws.send_json({"type": "pong"})
                elif typ == "subscribe":
                    rid = data.get("room_id")
                    if rid:
                        engine.unsubscribe(room_id, push) if room_id else None
                        room_id = rid
                        engine.subscribe(room_id, push)
                        await engine.reconnect(user_id, room_id)
                        room = engine.rooms.get(room_id)
                        if room:
                            await ws.send_json({"type": "state", "room": engine.public_room(room, user_id)})
                elif typ == "place":
                    try:
                        room = await engine.place_ships(data.get("room_id") or room_id, user_id, data.get("ships"))
                        room_id = room.room_id
                        await ws.send_json({"type": "state", "room": engine.public_room(room, user_id)})
                    except ValueError as e:
                        await ws.send_json({"type": "error", "error": str(e)})
                elif typ == "shoot":
                    try:
                        payload = await engine.shoot(
                            data.get("room_id") or room_id,
                            user_id,
                            int(data["r"]),
                            int(data["c"]),
                        )
                        user = await db.get_user(user_id, chat_id)
                        await ws.send_json({**payload, "balance": int(user["coins"]) if user else None})
                    except (ValueError, KeyError) as e:
                        await ws.send_json({"type": "error", "error": str(e)})
                elif typ == "leave":
                    await engine.leave(user_id)
            elif msg.type in (web.WSMsgType.CLOSE, web.WSMsgType.ERROR):
                break
    finally:
        if room_id:
            engine.unsubscribe(room_id, push)
        await engine.leave(user_id)

    return ws


def create_app() -> web.Application:
    app = web.Application(middlewares=[cors_middleware])
    app.router.add_get("/health", health)
    app.router.add_get("/api/sea/me", me)
    app.router.add_get("/api/sea/leaderboard", leaderboard)
    app.router.add_post("/api/sea/quick", quick_match)
    app.router.add_post("/api/sea/cancel", cancel_search)
    app.router.add_get("/api/sea/status", match_status)
    app.router.add_post("/api/sea/private", create_private)
    app.router.add_post("/api/sea/join", join_private)
    app.router.add_post("/api/sea/practice", practice)
    app.router.add_post("/api/sea/place", place)
    app.router.add_post("/api/sea/shoot", shoot)
    app.router.add_get("/api/sea/room/{room_id}", room_state)
    app.router.add_get("/ws/sea", ws_handler)
    from seabattle.fleets_api import register_eco_routes
    register_eco_routes(app)
    return app


async def start_game_api() -> web.AppRunner:
    from seabattle import eco
    await eco.ensure_eco_tables()
    app = create_app()
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, GAME_API_HOST, GAME_API_PORT)
    await site.start()
    log.info("Sea Battle API on %s:%s (dev=%s)", GAME_API_HOST, GAME_API_PORT, GAME_API_DEV)
    return runner
