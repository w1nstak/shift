"""Игровая система Shift — уровни, экономика, мини-игры."""

from __future__ import annotations

import json
import random
import time
from dataclasses import dataclass

import db
from config import FOUNDER_ITEM, FOUNDER_PROFIT_BONUS

# ── Константы ──────────────────────────────────────────────────

XP_PER_LEVEL = 100
GAME_COOLDOWN = {
    "fish": 1800,   # 30 мин
    "mine": 900,    # 15 мин
    "lottery": 3600,
}

SHOP_ITEMS = {
    "щит": {"name": "🛡️ Щит", "price": 500, "desc": "+20% шанс победы в КНБ/дуэли"},
    "клевер": {"name": "🍀 Клевер", "price": 300, "desc": "Гарантированный выигрыш в слотах (1 раз)"},
    "удочка": {"name": "🎣 Удочка Pro", "price": 400, "desc": "×2 награда с рыбалки"},
    "кирка": {"name": "⛏️ Кирка Pro", "price": 400, "desc": "×2 награда из шахты"},
    "vip": {"name": "💎 VIP-значок", "price": 1000, "desc": "Особый статус в профиле"},
    "билет": {"name": "🎟️ Золотой билет", "price": 150, "desc": "×3 шанс в лотерее"},
}

SPECIAL_ITEMS = {
    "брелок_репе": {
        "name": "Брелок",
        "desc": "+10% к прибыли",
    },
}

DIVIDER = "┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈"

CASES = {
    "обычный": {"price": 50, "drops": [
        (40, "coins", 10, 30), (30, "coins", 30, 80),
        (20, "item", "клевер", 1), (8, "coins", 80, 150), (2, "item", "щит", 1),
    ]},
    "редкий": {"price": 200, "drops": [
        (35, "coins", 50, 120), (25, "coins", 120, 300),
        (20, "item", "удочка", 1), (15, "item", "кирка", 1), (5, "item", "vip", 1),
    ]},
    "легенда": {"price": 500, "drops": [
        (30, "coins", 200, 500), (25, "coins", 500, 1000),
        (25, "item", "щит", 2), (15, "item", "vip", 1), (5, "coins", 1000, 2500),
    ]},
}

FISH_TABLE = [
    (35, "🐟 Карась", 5, 15),
    (25, "🐠 Окунь", 15, 35),
    (20, "🐡 Фугу", 30, 60),
    (12, "🦈 Акула", 60, 120),
    (5, "🐋 Кит", 150, 300),
    (3, "💎 Золотая рыбка", 400, 800),
]

MINE_TABLE = [
    (30, "🪨 Камень", 3, 10),
    (25, "🧱 Уголь", 10, 25),
    (20, "🔩 Железо", 20, 50),
    (15, "🥈 Серебро", 40, 90),
    (7, "🥇 Золото", 80, 180),
    (3, "💎 Алмаз", 200, 500),
]

TRIVIA = [
    ("Столица Франции?", "париж", ["париж", "paris"]),
    ("2 + 2 × 2 = ?", "6", ["6", "шесть"]),
    ("Сколько планет в СС?", "8", ["8", "восемь"]),
    ("Язык программирования со змеёй?", "python", ["python", "питон"]),
    ("Telegram создан в каком году?", "2013", ["2013"]),
    ("Самая большая планета?", "юпитер", ["юпiter", "юпитер", "jupiter"]),
    ("Сколько бит в байте?", "8", ["8", "восемь"]),
    ("HTTP — это протокол...", "передачи", ["передачи", "передача", "http"]),
]

RPS = {"к": "✊ камень", "н": "✋ бумага", "б": "✌️ ножницы"}
RPS_BEATS = {"к": "б", "б": "н", "н": "к"}

ROULETTE_RED = {1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36}

# Активные сессии: (user_id, chat_id) -> state
_sessions: dict[tuple[int, int], dict] = {}


@dataclass
class GameResult:
    text: str
    coins_delta: int = 0
    xp_delta: int = 0
    win: bool | None = None


def xp_for_level(level: int) -> int:
    return level * XP_PER_LEVEL


def level_title(level: int) -> str:
    if level < 5:
        return "🌱 Новичок"
    if level < 10:
        return "⚔️ Искатель"
    if level < 20:
        return "🏅 Ветеран"
    if level < 35:
        return "👑 Мастер"
    return "💫 Легенда"


def _pick_weighted(table: list) -> tuple:
    total = sum(row[0] for row in table)
    roll = random.randint(1, total)
    acc = 0
    for row in table:
        acc += row[0]
        if roll <= acc:
            return row
    return table[-1]


def _parse_bet(args: list[str], default: int = 50) -> int | None:
    if not args:
        return default
    try:
        bet = int(args[0])
        return bet if bet > 0 else None
    except ValueError:
        return None


async def _charge(user_id: int, chat_id: int, bet: int) -> str | None:
    user = await db.get_user(user_id, chat_id)
    if not user or user["coins"] < bet:
        return "❌ Недостаточно монет."
    await db.add_coins(user_id, chat_id, -bet)
    return None


async def apply_founder_bonus(user_id: int, chat_id: int, amount: int) -> tuple[int, int]:
    """+10% к прибыли при наличии Брелока РЕРЕ. Возвращает (итого, бонус)."""
    if amount <= 0:
        return amount, 0
    inv = await db.get_inventory(user_id, chat_id)
    if inv.get(FOUNDER_ITEM, 0) <= 0:
        return amount, 0
    extra = int(amount * FOUNDER_PROFIT_BONUS)
    if extra < 1:
        return amount, 0
    return amount + extra, extra


def founder_tag(extra: int) -> str:
    return f" <i>🔑+{extra}</i>" if extra else ""


async def _reward(user_id: int, chat_id: int, result: GameResult) -> str:
    bonus_extra = 0
    if result.coins_delta > 0:
        result.coins_delta, bonus_extra = await apply_founder_bonus(
            user_id, chat_id, result.coins_delta
        )
    if result.coins_delta:
        bal = await db.add_coins(user_id, chat_id, result.coins_delta)
    else:
        user = await db.get_user(user_id, chat_id)
        bal = user["coins"]
    if result.xp_delta:
        lvl_info = await db.add_xp(user_id, chat_id, result.xp_delta)
    else:
        lvl_info = await db.get_level_info(user_id, chat_id)
    if result.win is True:
        await db.record_game(user_id, chat_id, won=True)
    elif result.win is False:
        await db.record_game(user_id, chat_id, won=False)
    extra = ""
    if lvl_info.get("level_up"):
        extra = f"\n🎉 Новый уровень: {lvl_info['level']} ({level_title(lvl_info['level'])})!"
    tag = founder_tag(bonus_extra)
    return result.text + tag + f"\n💰 {bal}{extra}"


def _item_name(key: str) -> str:
    if key in SHOP_ITEMS:
        return SHOP_ITEMS[key]["name"]
    if key in SPECIAL_ITEMS:
        return SPECIAL_ITEMS[key]["name"]
    return key


def _has_item(inv: dict, item: str) -> bool:
    return inv.get(item, 0) > 0


async def _use_item(user_id: int, chat_id: int, item: str) -> bool:
    inv = await db.get_inventory(user_id, chat_id)
    if inv.get(item, 0) <= 0:
        return False
    await db.set_inventory_item(user_id, chat_id, item, inv[item] - 1)
    return True


# ── Игры ───────────────────────────────────────────────────────

async def play_rps(user_id: int, chat_id: int, args: list[str]) -> str:
    bet = _parse_bet(args, 30)
    if bet is None:
        return "❌ Ставка должна быть > 0."
    choice = args[1].lower()[0] if len(args) > 1 else None
    if choice not in RPS:
        return "❌ Выбери: <code>кнб [ставка] к/н/б</code>\n✊ камень ✋ бумага ✌️ ножницы"
    err = await _charge(user_id, chat_id, bet)
    if err:
        return err
    inv = await db.get_inventory(user_id, chat_id)
    bot_choice = random.choice(list(RPS.keys()))
    win = RPS_BEATS[choice] == bot_choice
    draw = choice == bot_choice
    if draw:
        await db.add_coins(user_id, chat_id, bet)
        text = f"🤝 Ничья!\nТы: {RPS[choice]} | Бот: {RPS[bot_choice]}\nСтавка возвращена."
        return await _reward(user_id, chat_id, GameResult(text, xp_delta=5))
    if win or (_has_item(inv, "щит") and random.random() < 0.2):
        if _has_item(inv, "щит") and win:
            await _use_item(user_id, chat_id, "щит")
        prize = bet * 2
        text = f"🏆 Победа!\nТы: {RPS[choice]} | Бот: {RPS[bot_choice]}\n+{prize} монет"
        return await _reward(user_id, chat_id, GameResult(text, prize, xp_delta=15, win=True))
    text = f"💀 Проигрыш!\nТы: {RPS[choice]} | Бот: {RPS[bot_choice]}\n-{bet} монет"
    return await _reward(user_id, chat_id, GameResult(text, xp_delta=5, win=False))


async def play_roulette(user_id: int, chat_id: int, args: list[str]) -> str:
    bet = _parse_bet(args, 50)
    if bet is None:
        return "❌ Укажи ставку."
    if len(args) < 2:
        return "❌ <code>рулетка [ставка] [число 0-36 / красное / чёрное / зелёное]</code>"
    target = args[1].lower()
    err = await _charge(user_id, chat_id, bet)
    if err:
        return err
    number = random.randint(0, 36)
    color = "🟢 зелёное" if number == 0 else ("🔴 красное" if number in ROULETTE_RED else "⚫ чёрное")
    win = False
    mult = 0
    if target == "зелёное" or target == "green" or target == "0":
        win = number == 0
        mult = 14
    elif target in ("красное", "red", "красный"):
        win = number in ROULETTE_RED
        mult = 2
    elif target in ("чёрное", "black", "черное", "черный"):
        win = number != 0 and number not in ROULETTE_RED
        mult = 2
    else:
        try:
            num = int(target)
            win = num == number
            mult = 36
        except ValueError:
            await db.add_coins(user_id, chat_id, bet)
            return "❌ Неверная ставка. Монеты возвращены."
    if win:
        prize = bet * mult
        text = f"🎡 Выпало: {number} ({color})\n🎉 Выигрыш ×{mult}! +{prize}"
        return await _reward(user_id, chat_id, GameResult(text, prize, xp_delta=20, win=True))
    text = f"🎡 Выпало: {number} ({color})\n😔 Не угадал. -{bet}"
    return await _reward(user_id, chat_id, GameResult(text, xp_delta=5, win=False))


async def play_blackjack(user_id: int, chat_id: int, args: list[str]) -> str:
    key = (user_id, chat_id)
    bet = _parse_bet(args, 50)
    if bet is None:
        return "❌ Укажи ставку."

    if key not in _sessions:
        err = await _charge(user_id, chat_id, bet)
        if err:
            return err
        deck = list(range(1, 11)) * 4 + [10] * 12
        random.shuffle(deck)

        def hand_val(cards):
            total = sum(min(c, 10) for c in cards)
            aces = sum(1 for c in cards if c == 1)
            while aces and total + 10 <= 21:
                total += 10
                aces -= 1
            return total

        player = [deck.pop(), deck.pop()]
        dealer = [deck.pop(), deck.pop()]
        _sessions[key] = {"deck": deck, "player": player, "dealer": dealer, "bet": bet}

        if hand_val(player) == 21:
            prize = int(bet * 2.5)
            del _sessions[key]
            text = f"🃏 BLACKJACK!\nТвои: {_fmt_cards(player)} = 21\n+{prize} монет"
            return await _reward(user_id, chat_id, GameResult(text, prize, xp_delta=25, win=True))

        return (
            f"🃏 <b>Блэкджек</b> — ставка {bet}\n"
            f"Твои: {_fmt_cards(player)} = {hand_val(player)}\n"
            f"Дилер: {_fmt_cards([dealer[0]])} + ❓\n\n"
            f"➡️ <code>ещё</code> — взять карту\n"
            f"➡️ <code>стоп</code> — хватит"
        )

    return "❌ Игра уже идёт! Используй <code>ещё</code> или <code>стоп</code>"


async def blackjack_hit(user_id: int, chat_id: int) -> str:
    key = (user_id, chat_id)
    s = _sessions.get(key)
    if not s:
        return "❌ Нет активной игры. Начни: <code>21 [ставка]</code>"
    s["player"].append(s["deck"].pop())

    def hand_val(cards):
        total = sum(min(c, 10) for c in cards)
        aces = sum(1 for c in cards if c == 1)
        while aces and total + 10 <= 21:
            total += 10
            aces -= 1
        return total

    pv = hand_val(s["player"])
    if pv > 21:
        bet = s["bet"]
        del _sessions[key]
        text = f"💥 Перебор! {_fmt_cards(s['player'])} = {pv}\n-{bet} монет"
        return await _reward(user_id, chat_id, GameResult(text, xp_delta=5, win=False))
    return (
        f"🃏 Твои: {_fmt_cards(s['player'])} = {pv}\n"
        f"➡️ <code>ещё</code> или <code>стоп</code>"
    )


async def blackjack_stand(user_id: int, chat_id: int) -> str:
    key = (user_id, chat_id)
    s = _sessions.get(key)
    if not s:
        return "❌ Нет активной игры."

    def hand_val(cards):
        total = sum(min(c, 10) for c in cards)
        aces = sum(1 for c in cards if c == 1)
        while aces and total + 10 <= 21:
            total += 10
            aces -= 1
        return total

    while hand_val(s["dealer"]) < 17:
        s["dealer"].append(s["deck"].pop())
    pv, dv = hand_val(s["player"]), hand_val(s["dealer"])
    bet = s["bet"]
    del _sessions[key]

    if dv > 21 or pv > dv:
        prize = bet * 2
        text = (
            f"🏆 Победа!\nТы: {_fmt_cards(s['player'])} = {pv}\n"
            f"Дилер: {_fmt_cards(s['dealer'])} = {dv}\n+{prize} монет"
        )
        return await _reward(user_id, chat_id, GameResult(text, prize, xp_delta=20, win=True))
    if pv == dv:
        await db.add_coins(user_id, chat_id, bet)
        return f"🤝 Ничья!\nТы: {pv} | Дилер: {dv}\nСтавка возвращена."
    text = (
        f"💀 Проигрыш!\nТы: {_fmt_cards(s['player'])} = {pv}\n"
        f"Дилер: {_fmt_cards(s['dealer'])} = {dv}\n-{bet}"
    )
    return await _reward(user_id, chat_id, GameResult(text, xp_delta=5, win=False))


def _fmt_cards(cards: list[int]) -> str:
    names = {1: "A", 11: "J", 12: "Q", 13: "K"}
    return " ".join(names.get(c, str(c)) for c in cards)


async def play_guess(user_id: int, chat_id: int, args: list[str]) -> str:
    if len(args) < 2:
        return "❌ <code>угадай [число 1-100] [ставка]</code>"
    try:
        guess = int(args[0])
        bet = int(args[1])
    except ValueError:
        return "❌ Укажи число и ставку."
    if not 1 <= guess <= 100 or bet <= 0:
        return "❌ Число 1-100, ставка > 0."
    err = await _charge(user_id, chat_id, bet)
    if err:
        return err
    secret = random.randint(1, 100)
    diff = abs(guess - secret)
    if diff == 0:
        prize = bet * 10
        text = f"🎯 Точно! Загадано {secret}\n🎉 ДЖЕКПОТ ×10! +{prize}"
        return await _reward(user_id, chat_id, GameResult(text, prize, xp_delta=30, win=True))
    if diff <= 5:
        prize = bet * 3
        text = f"🔥 Близко! Загадано {secret}, ты: {guess}\n+{prize} (×3)"
        return await _reward(user_id, chat_id, GameResult(text, prize, xp_delta=15, win=True))
    if diff <= 15:
        prize = bet
        await db.add_coins(user_id, chat_id, bet)
        text = f"😅 Неплохо! Загадано {secret}, ты: {guess}\nСтавка возвращена"
        return await _reward(user_id, chat_id, GameResult(text, xp_delta=5))
    hint = "меньше" if guess > secret else "больше"
    text = f"❌ Мимо! Загадано {secret} (нужно {hint})\n-{bet}"
    return await _reward(user_id, chat_id, GameResult(text, xp_delta=5, win=False))


async def play_lottery(user_id: int, chat_id: int, args: list[str]) -> str:
    bet = _parse_bet(args, 20)
    if bet is None or bet < 10:
        return "❌ Билет от 10 монет: <code>лотерея [ставка]</code>"
    user = await db.get_user(user_id, chat_id)
    last = user.get("last_lottery", 0) or 0
    if time.time() - last < GAME_COOLDOWN["lottery"]:
        left = int(GAME_COOLDOWN["lottery"] - (time.time() - last))
        return f"⏳ Следующая лотерея через {left // 60} мин"
    err = await _charge(user_id, chat_id, bet)
    if err:
        return err
    await db.set_cooldown(user_id, chat_id, "last_lottery", time.time())
    inv = await db.get_inventory(user_id, chat_id)
    win_chance = 0.15 if _has_item(inv, "билет") else 0.05
    if _has_item(inv, "билет"):
        await _use_item(user_id, chat_id, "билет")
    if random.random() < win_chance:
        prize = bet * random.randint(5, 20)
        text = f"🎟️ ЛОТЕРЕЯ!\n🎊 Твой билет выиграл!\n+{prize} монет"
        return await _reward(user_id, chat_id, GameResult(text, prize, xp_delta=20, win=True))
    text = f"🎟️ Лотерея\n😔 Билет не выиграл. Попробуй позже!"
    return await _reward(user_id, chat_id, GameResult(text, xp_delta=3, win=False))


async def play_fish(user_id: int, chat_id: int) -> str:
    user = await db.get_user(user_id, chat_id)
    last = user.get("last_fish", 0) or 0
    if time.time() - last < GAME_COOLDOWN["fish"]:
        left = int(GAME_COOLDOWN["fish"] - (time.time() - last))
        return f"⏳ Рыбалка через {left // 60} мин {left % 60} сек"
    await db.set_cooldown(user_id, chat_id, "last_fish", time.time())
    _, name, lo, hi = _pick_weighted(FISH_TABLE)
    reward = random.randint(lo, hi)
    inv = await db.get_inventory(user_id, chat_id)
    if _has_item(inv, "удочка"):
        reward *= 2
        rod = " (×2 🎣)"
    else:
        rod = ""
    text = f"🎣 Улов: {name}{rod}\n+{reward} монет"
    return await _reward(user_id, chat_id, GameResult(text, reward, xp_delta=10, win=True))


async def play_mine(user_id: int, chat_id: int) -> str:
    user = await db.get_user(user_id, chat_id)
    last = user.get("last_mine", 0) or 0
    if time.time() - last < GAME_COOLDOWN["mine"]:
        left = int(GAME_COOLDOWN["mine"] - (time.time() - last))
        return f"⏳ Шахта через {left // 60} мин {left % 60} сек"
    await db.set_cooldown(user_id, chat_id, "last_mine", time.time())
    _, name, lo, hi = _pick_weighted(MINE_TABLE)
    reward = random.randint(lo, hi)
    inv = await db.get_inventory(user_id, chat_id)
    if _has_item(inv, "кирка"):
        reward *= 2
        pick = " (×2 ⛏️)"
    else:
        pick = ""
    text = f"⛏️ Находка: {name}{pick}\n+{reward} монет"
    return await _reward(user_id, chat_id, GameResult(text, reward, xp_delta=10, win=True))


async def play_wheel(user_id: int, chat_id: int, args: list[str]) -> str:
    bet = _parse_bet(args, 40)
    if bet is None:
        return "❌ <code>колесо [ставка]</code>"
    err = await _charge(user_id, chat_id, bet)
    if err:
        return err
    sectors = [
        ("💀", 0), ("×1.5", 1.5), ("×2", 2), ("×0.5", 0.5),
        ("×3", 3), ("💀", 0), ("×1.5", 1.5), ("×5", 5),
    ]
    emoji, mult = random.choice(sectors)
    if mult == 0:
        text = f"🎡 Колесо: {emoji}\n😵 Пусто! -{bet}"
        return await _reward(user_id, chat_id, GameResult(text, xp_delta=5, win=False))
    prize = int(bet * mult)
    net = prize - bet
    text = f"🎡 Колесо: {emoji}\n{'+' if net >= 0 else ''}{net} монет (×{mult})"
    return await _reward(user_id, chat_id, GameResult(text, net, xp_delta=10, win=net > 0))


async def play_crash(user_id: int, chat_id: int, args: list[str]) -> str:
    bet = _parse_bet(args, 50)
    if bet is None:
        return "❌ <code>краш [ставка]</code>"
    err = await _charge(user_id, chat_id, bet)
    if err:
        return err
    crash_at = round(random.uniform(1.1, 5.0), 2)
    if random.random() < 0.4:
        text = f"📈 Crash!\n💥 Обвал на ×{crash_at}\n😔 Не успел забрать. -{bet}"
        return await _reward(user_id, chat_id, GameResult(text, xp_delta=8, win=False))
    cashout = round(random.uniform(1.1, min(crash_at, 3.0)), 2)
    prize = int(bet * cashout)
    net = prize - bet
    text = f"📈 Crash!\n✅ Забрал на ×{cashout} (обвал ×{crash_at})\n+{net} монет"
    return await _reward(user_id, chat_id, GameResult(text, net, xp_delta=12, win=True))


async def play_trivia(user_id: int, chat_id: int) -> str:
    q, _, answers = random.choice(TRIVIA)
    key = (user_id, chat_id)
    _sessions[key] = {"type": "trivia", "answers": answers, "deadline": time.time() + 30}
    return f"❓ <b>Викторина</b> (+50 монет)\n\n{q}\n\nОтветь в течение 30 сек!"


async def check_trivia(user_id: int, chat_id: int, text: str) -> str | None:
    key = (user_id, chat_id)
    s = _sessions.get(key)
    if not s or s.get("type") != "trivia":
        return None
    if time.time() > s["deadline"]:
        del _sessions[key]
        return "⏰ Время вышло!"
    if text.strip().lower() not in s["answers"]:
        return None
    del _sessions[key]
    return await _reward(user_id, chat_id, GameResult("✅ Верно!", 50, xp_delta=15, win=True))


async def play_case(user_id: int, chat_id: int, args: list[str]) -> str:
    case_type = args[0].lower() if args else "обычный"
    if case_type not in CASES:
        types = ", ".join(CASES)
        return f"❌ <code>кейс [тип]</code>\nДоступно: {types}"
    case = CASES[case_type]
    err = await _charge(user_id, chat_id, case["price"])
    if err:
        return err
    weight, kind, val, val2 = _pick_weighted(case["drops"])
    if kind == "coins":
        amount = random.randint(val, val2)
        text = f"📦 Кейс «{case_type}»\n💰 Выпало: {amount} монет!"
        return await _reward(user_id, chat_id, GameResult(text, amount, xp_delta=10, win=True))
    await db.set_inventory_item(user_id, chat_id, val, (await db.get_inventory(user_id, chat_id)).get(val, 0) + val2)
    item = SHOP_ITEMS.get(val, {}).get("name", val)
    text = f"📦 Кейс «{case_type}»\n🎁 Выпало: {item} ×{val2}!"
    return await _reward(user_id, chat_id, GameResult(text, xp_delta=10, win=True))


async def play_darts(user_id: int, chat_id: int) -> str:
    score = random.randint(1, 6)
    reward = score * 5
    text = f"🎯 Дартс!\nОчки: {score}/6\n+{reward} монет"
    return await _reward(user_id, chat_id, GameResult(text, reward, xp_delta=8, win=score >= 4))


async def play_basketball(user_id: int, chat_id: int) -> str:
    score = random.randint(1, 5)
    if score >= 4:
        reward = 40
        text = f"🏀 Попадание! ({score}/5)\n+{reward} монет"
        return await _reward(user_id, chat_id, GameResult(text, reward, xp_delta=10, win=True))
    text = f"🏀 Мимо... ({score}/5)\n+5 монет за попытку"
    return await _reward(user_id, chat_id, GameResult(text, 5, xp_delta=5))


async def play_football(user_id: int, chat_id: int) -> str:
    score = random.randint(1, 5)
    if score >= 4:
        reward = 40
        text = f"⚽ ГОООЛ! ({score}/5)\n+{reward} монет"
        return await _reward(user_id, chat_id, GameResult(text, reward, xp_delta=10, win=True))
    text = f"⚽ Мимо ворот ({score}/5)\n+5 монет"
    return await _reward(user_id, chat_id, GameResult(text, 5, xp_delta=5))


async def play_bowling(user_id: int, chat_id: int, args: list[str]) -> str:
    bet = _parse_bet(args, 30)
    if bet is None:
        return "❌ <code>боулинг [ставка]</code>"
    err = await _charge(user_id, chat_id, bet)
    if err:
        return err
    pins = random.randint(0, 6)
    if pins == 6:
        prize = bet * 3
        text = f"🎳 STRIKE!\n💥 Все кегли! +{prize}"
        return await _reward(user_id, chat_id, GameResult(text, prize, xp_delta=15, win=True))
    if pins >= 4:
        prize = bet
        await db.add_coins(user_id, chat_id, bet)
        text = f"🎳 Сбито {pins}/6\nСтавка возвращена"
        return await _reward(user_id, chat_id, GameResult(text, xp_delta=5))
    text = f"🎳 Сбито {pins}/6\n-{bet}"
    return await _reward(user_id, chat_id, GameResult(text, xp_delta=5, win=False))


async def play_race(user_id: int, chat_id: int, args: list[str]) -> str:
    bet = _parse_bet(args, 40)
    if bet is None:
        return "❌ <code>скачки [ставка] [1-5]</code>"
    if len(args) < 2:
        horses = "\n".join(f"  {i}. {'🐎🏇🐴🦄🎠'[i-1]} Лошадь {i}" for i in range(1, 6))
        return f"🏇 Выбери лошадь:\n{horses}\n<code>скачки [ставка] [номер]</code>"
    try:
        pick = int(args[1])
        if not 1 <= pick <= 5:
            raise ValueError
    except ValueError:
        return "❌ Номер лошади 1-5"
    err = await _charge(user_id, chat_id, bet)
    if err:
        return err
    winner = random.randint(1, 5)
    emojis = ["🐎", "🏇", "🐴", "🦄", "🎠"]
    if pick == winner:
        prize = bet * 4
        text = f"🏇 Победила {emojis[winner-1]} Лошадь {winner}!\n🎉 Твоя ставка! +{prize}"
        return await _reward(user_id, chat_id, GameResult(text, prize, xp_delta=15, win=True))
    text = f"🏇 Победила {emojis[winner-1]} Лошадь {winner}\nТвоя: #{pick}. -{bet}"
    return await _reward(user_id, chat_id, GameResult(text, xp_delta=5, win=False))


async def show_shop() -> str:
    lines = [f"🛒 <b>Магазин</b>\n{DIVIDER}\n"]
    for key, item in SHOP_ITEMS.items():
        lines.append(f"• <code>купить {key}</code> — {item['name']} ({item['price']}🪙)\n  <i>{item['desc']}</i>")
    return "\n".join(lines)


async def buy_item(user_id: int, chat_id: int, args: list[str]) -> str:
    if not args:
        return await show_shop()
    item_key = args[0].lower()
    if item_key not in SHOP_ITEMS:
        return f"❌ Нет такого товара. <code>магазин</code>"
    item = SHOP_ITEMS[item_key]
    user = await db.get_user(user_id, chat_id)
    if user["coins"] < item["price"]:
        return f"❌ Нужно {item['price']} монет."
    await db.add_coins(user_id, chat_id, -item["price"])
    inv = await db.get_inventory(user_id, chat_id)
    await db.set_inventory_item(user_id, chat_id, item_key, inv.get(item_key, 0) + 1)
    bal = (await db.get_user(user_id, chat_id))["coins"]
    return f"✅ Куплено: {item['name']}\n💰 Баланс: {bal}"


async def show_inventory(user_id: int, chat_id: int) -> str:
    inv = await db.get_inventory(user_id, chat_id)
    if not inv:
        return f"🎒 <b>Инвентарь пуст</b>\n{DIVIDER}\n<code>магазин</code> · <code>кейс</code>"
    lines = [f"🎒 <b>Инвентарь</b>\n{DIVIDER}\n"]
    for key, count in inv.items():
        name = _item_name(key)
        extra = ""
        if key in SPECIAL_ITEMS:
            extra = f"\n  <i>{SPECIAL_ITEMS[key]['desc']}</i>"
        lines.append(f"• {name} ×{count}{extra}")
    return "\n".join(lines)


async def show_game_profile(user_id: int, chat_id: int, name: str) -> str:
    user = await db.get_user(user_id, chat_id)
    lvl = user.get("level", 1)
    xp = user.get("xp", 0)
    needed = xp_for_level(lvl)
    wins = user.get("wins", 0)
    losses = user.get("losses", 0)
    played = user.get("games_played", 0)
    wr = f"{wins / played * 100:.0f}%" if played else "—"
    inv = await db.get_inventory(user_id, chat_id)
    badges = []
    if inv.get("брелок_репе", 0) > 0:
        badges.append(SPECIAL_ITEMS["брелок_репе"]["name"])
    if inv.get("vip", 0) > 0:
        badges.append(SHOP_ITEMS["vip"]["name"])
    badge_line = " ".join(badges)
    founder_note = ""
    if inv.get(FOUNDER_ITEM, 0) > 0:
        founder_note = f"\n<i>Брелок · +{int(FOUNDER_PROFIT_BONUS * 100)}% прибыль</i>"
    badge_line = f"\n{badge_line}" if badge_line else ""
    return (
        f"🎮 <b>{name}</b>\n"
        f"{DIVIDER}\n"
        f"{level_title(lvl)} · ур. {lvl} · {xp}/{needed} XP\n"
        f"💰 {user['coins']} · 🏆 {wins}W/{losses}L · {wr}{badge_line}{founder_note}"
    )


def games_help() -> str:
    return (
        f"🎮 <b>Игры</b>\n{DIVIDER}\n\n"
        "<b>🎰</b> <code>слот</code> <code>рулетка</code> <code>колесо</code> <code>краш</code> <code>лотерея</code>\n"
        "<b>🃏</b> <code>21</code> <code>кнб</code> <code>угадай</code>\n"
        "<b>⚔️</b> <code>дуэль</code> <code>скачки</code>\n"
        "<b>🎯</b> <code>куб</code> <code>монетка</code> <code>дартс</code> <code>баскет</code> <code>футбол</code> <code>боулинг</code>\n"
        "<b>⛏️</b> <code>рыбалка</code> <code>шахта</code>\n"
        "<b>📦</b> <code>кейс</code> <code>викторина</code> <code>магазин</code> <code>инвентарь</code>"
    )
