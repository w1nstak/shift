"""Shift Sea Battle — pure game rules (10×10 classic fleet)."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable

GRID = 10

# id, name, length
FLEET = (
    ("carrier", "Carrier", 5),
    ("battleship", "Battleship", 4),
    ("cruiser", "Cruiser", 3),
    ("submarine", "Submarine", 3),
    ("destroyer", "Destroyer", 2),
)

Cell = tuple[int, int]  # (r, c)


@dataclass
class Ship:
    sid: str
    name: str
    length: int
    cells: list[Cell] = field(default_factory=list)
    hits: set[Cell] = field(default_factory=set)

    @property
    def sunk(self) -> bool:
        return len(self.hits) >= self.length and self.length > 0


def neighbors(r: int, c: int, diag: bool = True) -> list[Cell]:
    out = []
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            if dr == 0 and dc == 0:
                continue
            if not diag and abs(dr) + abs(dc) != 1:
                continue
            nr, nc = r + dr, c + dc
            if 0 <= nr < GRID and 0 <= nc < GRID:
                out.append((nr, nc))
    return out


def cells_for(r: int, c: int, length: int, horizontal: bool) -> list[Cell] | None:
    cells = []
    for i in range(length):
        rr = r if horizontal else r + i
        cc = c + i if horizontal else c
        if not (0 <= rr < GRID and 0 <= cc < GRID):
            return None
        cells.append((rr, cc))
    return cells


def validate_placement(ships_payload: list[dict]) -> tuple[list[Ship] | None, str | None]:
    """ships_payload: [{id, r, c, horizontal}] — ids must match FLEET."""
    if not isinstance(ships_payload, list) or len(ships_payload) != len(FLEET):
        return None, "Нужно разместить все 5 кораблей"

    by_id = {s["id"]: s for s in ships_payload if isinstance(s, dict) and "id" in s}
    occupied: set[Cell] = set()
    ships: list[Ship] = []

    for sid, name, length in FLEET:
        raw = by_id.get(sid)
        if not raw:
            return None, f"Нет корабля: {name}"
        try:
            r = int(raw["r"])
            c = int(raw["c"])
            horizontal = bool(raw.get("horizontal", True))
        except (KeyError, TypeError, ValueError):
            return None, f"Некорректные координаты: {name}"

        cells = cells_for(r, c, length, horizontal)
        if cells is None:
            return None, f"{name} выходит за поле"

        # no overlap + no adjacent (including diagonal) — classic strict rules
        blocked = set(occupied)
        for oc in occupied:
            blocked.update(neighbors(*oc, diag=True))

        for cell in cells:
            if cell in blocked or cell in occupied:
                return None, f"{name} пересекается или слишком близко"

        occupied.update(cells)
        ships.append(Ship(sid=sid, name=name, length=length, cells=cells))

    return ships, None


def random_fleet() -> list[Ship]:
    import random

    ships: list[Ship] = []
    occupied: set[Cell] = set()
    for sid, name, length in FLEET:
        placed = False
        for _ in range(400):
            horizontal = random.random() > 0.5
            r = random.randint(0, GRID - 1)
            c = random.randint(0, GRID - 1)
            cells = cells_for(r, c, length, horizontal)
            if cells is None:
                continue
            blocked = set(occupied)
            for oc in occupied:
                blocked.update(neighbors(*oc, diag=True))
            if any(cell in blocked or cell in occupied for cell in cells):
                continue
            occupied.update(cells)
            ships.append(Ship(sid=sid, name=name, length=length, cells=cells))
            placed = True
            break
        if not placed:
            # fallback: clear and retry whole fleet
            return random_fleet()
    return ships


def ships_to_payload(ships: Iterable[Ship]) -> list[dict]:
    out = []
    for s in ships:
        r0, c0 = s.cells[0]
        horizontal = len(s.cells) > 1 and s.cells[1][0] == r0
        out.append({"id": s.sid, "r": r0, "c": c0, "horizontal": horizontal})
    return out


def board_map(ships: list[Ship]) -> dict[Cell, str]:
    m: dict[Cell, str] = {}
    for s in ships:
        for cell in s.cells:
            m[cell] = s.sid
    return m


def apply_shot(ships: list[Ship], r: int, c: int) -> dict:
    """Return result dict: miss | hit | sunk (+ ship id/name). Mutates ships."""
    if not (0 <= r < GRID and 0 <= c < GRID):
        return {"ok": False, "error": "Вне поля"}

    for s in ships:
        if (r, c) in s.cells:
            if (r, c) in s.hits:
                return {"ok": False, "error": "Уже стреляли"}
            s.hits.add((r, c))
            if s.sunk:
                return {
                    "ok": True,
                    "result": "sunk",
                    "ship_id": s.sid,
                    "ship_name": s.name,
                    "cells": list(s.cells),
                }
            return {"ok": True, "result": "hit", "ship_id": s.sid, "ship_name": s.name}

    return {"ok": True, "result": "miss"}


def all_sunk(ships: list[Ship]) -> bool:
    return all(s.sunk for s in ships)


def public_own_view(ships: list[Ship], shots_received: set[Cell]) -> dict:
    """Board for owner: ships visible + hits/misses on own water."""
    cells = {}
    for s in ships:
        for cell in s.cells:
            key = f"{cell[0]}_{cell[1]}"
            cells[key] = {
                "ship": s.sid,
                "hit": cell in s.hits,
                "sunk": s.sunk,
            }
    for r, c in shots_received:
        key = f"{r}_{c}"
        if key not in cells:
            cells[key] = {"ship": None, "hit": False, "miss": True}
    return {
        "ships": [
            {
                "id": s.sid,
                "name": s.name,
                "length": s.length,
                "sunk": s.sunk,
                "hits": len(s.hits),
                "cells": [{"r": r, "c": c} for r, c in s.cells],
            }
            for s in ships
        ],
        "cells": cells,
    }


def public_enemy_view(ships: list[Ship], shots: set[Cell]) -> dict:
    """Opponent board: only revealed cells."""
    ship_at = board_map(ships)
    cells = {}
    for r, c in shots:
        key = f"{r}_{c}"
        if (r, c) in ship_at:
            sid = ship_at[(r, c)]
            ship = next(s for s in ships if s.sid == sid)
            cells[key] = {
                "hit": True,
                "sunk": ship.sunk,
                "ship_id": sid if ship.sunk else None,
            }
        else:
            cells[key] = {"miss": True}
    return {
        "cells": cells,
        "ships_left": sum(1 for s in ships if not s.sunk),
        "sunk": [
            {"id": s.sid, "name": s.name, "cells": [{"r": r, "c": c} for r, c in s.cells]}
            for s in ships
            if s.sunk
        ],
    }
