"""Shift Sea Battle — room manager, matchmaking, coin escrow."""
from __future__ import annotations

import asyncio
import logging
import secrets
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Awaitable

import db
from config import SEA_BATTLE_MATCH_BOT_AFTER, SEA_BATTLE_STAKES
from seabattle import logic

log = logging.getLogger("shift.seabattle")

BOT_USER_ID = -1001

Status = str  # WAITING READY PLACING PLAYING FINISHED CANCELLED


@dataclass
class PlayerState:
    user_id: int
    chat_id: int
    name: str
    level: int = 1
    avatar: str = "?"
    photo_url: str = ""
    is_bot: bool = False
    ready: bool = False
    ships: list[logic.Ship] = field(default_factory=list)
    shots_made: set[logic.Cell] = field(default_factory=set)
    shots_received: set[logic.Cell] = field(default_factory=set)
    connected: bool = True
    disconnect_at: float | None = None
    shots: int = 0
    hits: int = 0


@dataclass
class Room:
    room_id: str
    stake: int
    chat_id: int
    mode: str  # quick | private | practice
    status: Status = "WAITING"
    players: dict[int, PlayerState] = field(default_factory=dict)
    turn: int | None = None
    invite_code: str | None = None
    pot: int = 0
    escrowed: bool = False
    winner_id: int | None = None
    created_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    last_event: dict | None = None
    rematch_votes: set[int] = field(default_factory=set)
    settled: bool = False

    def opponent(self, uid: int) -> PlayerState | None:
        for p in self.players.values():
            if p.user_id != uid:
                return p
        return None


class SeaBattleEngine:
    def __init__(self) -> None:
        self.rooms: dict[str, Room] = {}
        self.queue: dict[int, list[tuple[int, int, dict]]] = {s: [] for s in SEA_BATTLE_STAKES}
        # user_id -> room_id
        self.user_room: dict[int, str] = {}
        self._subscribers: dict[str, set[Callable[[dict], Awaitable[None]]]] = {}
        self._lock = asyncio.Lock()

    def subscribe(self, room_id: str, cb: Callable[[dict], Awaitable[None]]) -> None:
        self._subscribers.setdefault(room_id, set()).add(cb)

    def unsubscribe(self, room_id: str, cb: Callable[[dict], Awaitable[None]]) -> None:
        if room_id in self._subscribers:
            self._subscribers[room_id].discard(cb)

    async def broadcast(self, room_id: str, event: dict) -> None:
        room = self.rooms.get(room_id)
        if room:
            room.last_event = event
        for cb in list(self._subscribers.get(room_id, ())):
            try:
                await cb(event)
            except Exception:
                log.exception("broadcast failed")

    def _make_player(self, user_id: int, chat_id: int, meta: dict) -> PlayerState:
        name = (meta.get("name") or "Игрок").strip() or "Игрок"
        parts = name.split()
        initials = (parts[0][:1] + (parts[1][:1] if len(parts) > 1 else "")).upper() or "?"
        return PlayerState(
            user_id=user_id,
            chat_id=chat_id,
            name=name[:48],
            level=int(meta.get("level") or 1),
            avatar=(meta.get("avatar") or initials)[:2],
            photo_url=(meta.get("photo_url") or "")[:512],
            is_bot=bool(meta.get("is_bot")),
        )

    async def create_private(self, user_id: int, chat_id: int, stake: int, meta: dict) -> Room:
        if stake not in SEA_BATTLE_STAKES:
            raise ValueError("Недопустимая ставка")
        async with self._lock:
            await self._leave_queue(user_id)
            room = Room(
                room_id=uuid.uuid4().hex[:12],
                stake=stake,
                chat_id=chat_id,
                mode="private",
                invite_code=secrets.token_urlsafe(6)[:8].upper(),
                pot=stake * 2,
            )
            room.players[user_id] = self._make_player(user_id, chat_id, meta)
            self.rooms[room.room_id] = room
            self.user_room[user_id] = room.room_id
            return room

    async def join_invite(self, user_id: int, chat_id: int, code: str, meta: dict) -> Room:
        code = (code or "").strip().upper()
        async with self._lock:
            room = next((r for r in self.rooms.values() if r.invite_code == code and r.status == "WAITING"), None)
            if not room:
                raise ValueError("Приглашение не найдено или уже занято")
            if user_id in room.players:
                return room
            if len(room.players) >= 2:
                raise ValueError("Комната заполнена")
            if room.stake not in SEA_BATTLE_STAKES:
                raise ValueError("Недопустимая ставка")
            await self._ensure_balance(user_id, chat_id, room.stake)
            room.players[user_id] = self._make_player(user_id, chat_id, meta)
            self.user_room[user_id] = room.room_id
            room.status = "PLACING"
            await self._escrow(room)
        await self.broadcast(room.room_id, {"type": "matched", "room": self.public_room(room, user_id)})
        return room

    async def enqueue_quick(self, user_id: int, chat_id: int, stake: int, meta: dict) -> dict:
        if stake not in SEA_BATTLE_STAKES:
            raise ValueError("Недопустимая ставка")
        await self._ensure_balance(user_id, chat_id, stake)

        async with self._lock:
            await self._leave_queue(user_id)
            # try match existing
            q = self.queue[stake]
            while q:
                other_uid, other_cid, other_meta = q.pop(0)
                if other_uid == user_id:
                    continue
                if other_uid in self.user_room:
                    continue
                room = Room(
                    room_id=uuid.uuid4().hex[:12],
                    stake=stake,
                    chat_id=chat_id,
                    mode="quick",
                    pot=stake * 2,
                    status="PLACING",
                )
                room.players[other_uid] = self._make_player(other_uid, other_cid, other_meta)
                room.players[user_id] = self._make_player(user_id, chat_id, meta)
                self.rooms[room.room_id] = room
                self.user_room[other_uid] = room.room_id
                self.user_room[user_id] = room.room_id
                await self._escrow(room)
                await self.broadcast(room.room_id, {"type": "matched", "room": self.public_room(room)})
                return {"status": "matched", "room_id": room.room_id, "room": self.public_room(room, user_id)}

            q.append((user_id, chat_id, meta))
            self.user_room[user_id] = f"queue:{stake}"

        asyncio.create_task(self._bot_fallback(user_id, chat_id, stake, meta))
        return {"status": "searching", "stake": stake}

    async def _bot_fallback(self, user_id: int, chat_id: int, stake: int, meta: dict) -> None:
        await asyncio.sleep(SEA_BATTLE_MATCH_BOT_AFTER)
        async with self._lock:
            q = self.queue.get(stake, [])
            still = any(u == user_id for u, _, _ in q)
            if not still:
                return
            self.queue[stake] = [(u, c, m) for u, c, m in q if u != user_id]
            room = Room(
                room_id=uuid.uuid4().hex[:12],
                stake=stake,
                chat_id=chat_id,
                mode="practice",
                pot=stake * 2,
                status="PLACING",
            )
            room.players[user_id] = self._make_player(user_id, chat_id, meta)
            bot = self._make_player(
                BOT_USER_ID,
                chat_id,
                {"name": "Shift AI", "level": max(1, int(meta.get("level") or 1)), "is_bot": True},
            )
            bot.ships = logic.random_fleet()
            bot.ready = True
            room.players[BOT_USER_ID] = bot
            self.rooms[room.room_id] = room
            self.user_room[user_id] = room.room_id
            await self._escrow(room)
        await self.broadcast(room.room_id, {"type": "matched", "room": self.public_room(room, user_id), "vs_bot": True})

    async def start_practice(self, user_id: int, chat_id: int, stake: int, meta: dict) -> Room:
        if stake not in SEA_BATTLE_STAKES:
            raise ValueError("Недопустимая ставка")
        await self._ensure_balance(user_id, chat_id, stake)
        async with self._lock:
            await self._leave_queue(user_id)
            room = Room(
                room_id=uuid.uuid4().hex[:12],
                stake=stake,
                chat_id=chat_id,
                mode="practice",
                pot=stake * 2,
                status="PLACING",
            )
            room.players[user_id] = self._make_player(user_id, chat_id, meta)
            bot = self._make_player(
                BOT_USER_ID,
                chat_id,
                {"name": "Shift AI", "level": max(1, int(meta.get("level") or 1)), "is_bot": True},
            )
            bot.ships = logic.random_fleet()
            bot.ready = True
            room.players[BOT_USER_ID] = bot
            self.rooms[room.room_id] = room
            self.user_room[user_id] = room.room_id
            await self._escrow(room)
        return room

    async def cancel_search(self, user_id: int) -> None:
        async with self._lock:
            await self._leave_queue(user_id)

    async def _leave_queue(self, user_id: int) -> None:
        for stake, q in self.queue.items():
            self.queue[stake] = [(u, c, m) for u, c, m in q if u != user_id]
        rid = self.user_room.get(user_id)
        if rid and str(rid).startswith("queue:"):
            self.user_room.pop(user_id, None)

    async def _ensure_balance(self, user_id: int, chat_id: int, stake: int) -> None:
        if user_id == BOT_USER_ID:
            return
        await db.ensure_user(user_id, chat_id, None, "Player")
        user = await db.get_user(user_id, chat_id)
        if not user or int(user["coins"]) < stake:
            raise ValueError("Недостаточно S-Coins")

    async def _escrow(self, room: Room) -> None:
        if room.escrowed:
            return
        humans = [p for p in room.players.values() if not p.is_bot]
        for p in humans:
            await self._ensure_balance(p.user_id, p.chat_id, room.stake)
        for p in humans:
            await db.add_coins(p.user_id, p.chat_id, -room.stake)
        # practice: bot side stake comes from pot illusion — player still pays stake, wins 2x or loses stake
        room.escrowed = True
        room.pot = room.stake * 2

    async def place_ships(self, room_id: str, user_id: int, ships_payload: list) -> Room:
        async with self._lock:
            room = self.rooms.get(room_id)
            if not room or user_id not in room.players:
                raise ValueError("Комната не найдена")
            if room.status not in ("PLACING", "READY"):
                raise ValueError("Размещение недоступно")
            ships, err = logic.validate_placement(ships_payload)
            if err:
                raise ValueError(err)
            p = room.players[user_id]
            p.ships = ships
            p.ready = True

            if all(pl.ready for pl in room.players.values()) and len(room.players) == 2:
                room.status = "PLAYING"
                # first turn: human if vs bot, else lowest user_id
                humans = [pl for pl in room.players.values() if not pl.is_bot]
                room.turn = min(pl.user_id for pl in humans) if humans else min(room.players)
            else:
                room.status = "PLACING"

        await self.broadcast(room_id, {"type": "state", "room": self.public_room(room)})
        if room.status == "PLAYING" and room.turn == BOT_USER_ID:
            asyncio.create_task(self._bot_turn(room_id))
        return room

    async def shoot(self, room_id: str, user_id: int, r: int, c: int) -> dict:
        async with self._lock:
            room = self.rooms.get(room_id)
            if not room or user_id not in room.players:
                raise ValueError("Комната не найдена")
            if room.status != "PLAYING":
                raise ValueError("Бой ещё не начался")
            if room.turn != user_id:
                raise ValueError("Сейчас ход соперника")
            shooter = room.players[user_id]
            target = room.opponent(user_id)
            if not target or not target.ships:
                raise ValueError("Соперник не готов")

            cell = (int(r), int(c))
            if cell in shooter.shots_made:
                raise ValueError("Уже стреляли сюда")

            result = logic.apply_shot(target.ships, cell[0], cell[1])
            if not result.get("ok"):
                raise ValueError(result.get("error") or "Неверный выстрел")

            shooter.shots_made.add(cell)
            target.shots_received.add(cell)
            shooter.shots += 1
            if result["result"] in ("hit", "sunk"):
                shooter.hits += 1

            finished = False
            if logic.all_sunk(target.ships):
                finished = True
                room.status = "FINISHED"
                room.winner_id = user_id
                room.finished_at = time.time()
                room.turn = None
            elif result["result"] == "miss":
                room.turn = target.user_id
            # hit/sunk → same player continues

            payload = {
                "type": "shot",
                "by": user_id,
                "r": cell[0],
                "c": cell[1],
                "result": result["result"],
                "ship_id": result.get("ship_id"),
                "ship_name": result.get("ship_name"),
                "cells": [{"r": x, "c": y} for x, y in result.get("cells", [])] if result.get("cells") else None,
                "turn": room.turn,
                "finished": finished,
                "winner_id": room.winner_id,
            }
            room.last_event = payload

        if finished:
            await self._settle(room)

        await self.broadcast(room_id, {**payload, "room": self.public_room(room)})

        if room.status == "PLAYING" and room.turn == BOT_USER_ID:
            asyncio.create_task(self._bot_turn(room_id))

        return payload

    async def _bot_turn(self, room_id: str) -> None:
        await asyncio.sleep(0.75 + (0.4 * (secrets.randbelow(3))))
        async with self._lock:
            room = self.rooms.get(room_id)
            if not room or room.status != "PLAYING" or room.turn != BOT_USER_ID:
                return
            bot = room.players[BOT_USER_ID]
            human = room.opponent(BOT_USER_ID)
            if not human:
                return
            # simple hunt: random unknown cell, prefer adjacent to hits
            candidates = [(r, c) for r in range(logic.GRID) for c in range(logic.GRID) if (r, c) not in bot.shots_made]
            prefer = []
            for r, c in list(bot.shots_made):
                # if that shot was a hit on human
                for s in human.ships:
                    if (r, c) in s.cells and not s.sunk:
                        for nr, nc in logic.neighbors(r, c, diag=False):
                            if (nr, nc) not in bot.shots_made:
                                prefer.append((nr, nc))
            pool = prefer or candidates
            if not pool:
                return
            r, c = pool[secrets.randbelow(len(pool))]

        try:
            await self.shoot(room_id, BOT_USER_ID, r, c)
        except Exception:
            log.exception("bot shot failed")

    async def _settle(self, room: Room) -> None:
        if room.winner_id is None or room.settled:
            return
        room.settled = True
        winner = room.players.get(room.winner_id)
        loser = room.opponent(room.winner_id)
        if not winner:
            return
        # pay pot to winner (if bot wins, stake stays burned / bank)
        if not winner.is_bot:
            await db.add_coins(winner.user_id, winner.chat_id, room.pot)
            await db.record_game(winner.user_id, winner.chat_id, won=True)
            await db.add_xp(winner.user_id, winner.chat_id, 25)
            await db.record_seabattle_result(
                winner.user_id, winner.chat_id, won=True, stake=room.stake, shots=winner.shots, hits=winner.hits
            )
        if loser and not loser.is_bot:
            await db.record_game(loser.user_id, loser.chat_id, won=False)
            await db.record_seabattle_result(
                loser.user_id, loser.chat_id, won=False, stake=room.stake, shots=loser.shots, hits=loser.hits
            )

    async def leave(self, user_id: int) -> None:
        async with self._lock:
            await self._leave_queue(user_id)
            rid = self.user_room.get(user_id)
            if not rid or str(rid).startswith("queue:"):
                self.user_room.pop(user_id, None)
                return
            room = self.rooms.get(rid)
            if not room:
                self.user_room.pop(user_id, None)
                return
            p = room.players.get(user_id)
            if p:
                p.connected = False
                p.disconnect_at = time.time()

        await self.broadcast(rid, {"type": "disconnect", "user_id": user_id})
        asyncio.create_task(self._disconnect_grace(rid, user_id))

    async def _disconnect_grace(self, room_id: str, user_id: int) -> None:
        await asyncio.sleep(45)
        async with self._lock:
            room = self.rooms.get(room_id)
            if not room or room.status in ("FINISHED", "CANCELLED"):
                return
            p = room.players.get(user_id)
            if not p or p.connected:
                return
            # forfeit
            opp = room.opponent(user_id)
            if opp and room.status == "PLAYING":
                room.status = "FINISHED"
                room.winner_id = opp.user_id
                room.finished_at = time.time()
            elif room.status in ("WAITING", "PLACING") and room.escrowed:
                # refund humans
                for pl in room.players.values():
                    if not pl.is_bot:
                        await db.add_coins(pl.user_id, pl.chat_id, room.stake)
                room.escrowed = False
                room.status = "CANCELLED"
            self.user_room.pop(user_id, None)

        if room and room.status == "FINISHED":
            await self._settle(room)
            await self.broadcast(room_id, {"type": "forfeit", "winner_id": room.winner_id, "room": self.public_room(room)})
        elif room:
            await self.broadcast(room_id, {"type": "cancelled", "room": self.public_room(room)})

    async def reconnect(self, user_id: int, room_id: str) -> Room | None:
        room = self.rooms.get(room_id)
        if not room or user_id not in room.players:
            return None
        room.players[user_id].connected = True
        room.players[user_id].disconnect_at = None
        self.user_room[user_id] = room_id
        return room

    def public_room(self, room: Room, viewer_id: int | None = None) -> dict[str, Any]:
        players = []
        for p in room.players.values():
            players.append({
                "user_id": p.user_id,
                "name": p.name,
                "level": p.level,
                "avatar": p.avatar,
                "photo_url": p.photo_url,
                "ready": p.ready,
                "is_bot": p.is_bot,
                "connected": p.connected,
                "shots": p.shots,
                "hits": p.hits,
            })
        data: dict[str, Any] = {
            "room_id": room.room_id,
            "stake": room.stake,
            "pot": room.pot,
            "status": room.status,
            "mode": room.mode,
            "invite_code": room.invite_code,
            "turn": room.turn,
            "winner_id": room.winner_id,
            "players": players,
        }
        if viewer_id is not None and viewer_id in room.players:
            me = room.players[viewer_id]
            opp = room.opponent(viewer_id)
            data["you"] = {
                "user_id": me.user_id,
                "ready": me.ready,
                "board": logic.public_own_view(me.ships, me.shots_received) if me.ships else None,
                "shots": me.shots,
                "hits": me.hits,
            }
            if opp:
                data["enemy"] = {
                    "user_id": opp.user_id,
                    "name": opp.name,
                    "level": opp.level,
                    "avatar": opp.avatar,
                    "photo_url": opp.photo_url,
                    "ready": opp.ready,
                    "is_bot": opp.is_bot,
                    "board": logic.public_enemy_view(opp.ships, me.shots_made) if opp.ships else {"cells": {}, "ships_left": 5, "sunk": []},
                }
            if room.status == "FINISHED":
                bal = None
                # balance fetched async elsewhere
                data["result"] = {
                    "won": room.winner_id == viewer_id,
                    "delta": room.pot if room.winner_id == viewer_id else -room.stake,
                    "stake": room.stake,
                    "pot": room.pot,
                }
        return data


engine = SeaBattleEngine()
