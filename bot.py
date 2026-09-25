import asyncio
import json
import logging
import random
import re
import time
from datetime import datetime, timedelta
from urllib.parse import urlencode, urlparse

from aiogram import Bot, Dispatcher, F, Router
from aiogram.enums import ChatMemberStatus, ChatType, ParseMode
from aiogram.filters import Command, CommandStart
from aiogram.types import (
    ChatMemberUpdated,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    MenuButtonWebApp,
    Message,
    WebAppInfo,
)

import db
import games
from config import BOT_NAME, BOT_TOKEN, FOUNDER_ITEM, FOUNDER_PROFIT_BONUS, GAME_API_URL, MINI_APP_URL, PREFIXES

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("shift")

router = Router()

# Антифлуд: {chat_id: {user_id: [timestamps]}}
_flood: dict[int, dict[int, list[float]]] = {}

DURATION_MAP = {
    "м": 60,
    "мин": 60,
    "минут": 60,
    "ч": 3600,
    "час": 3600,
    "часов": 3600,
    "д": 86400,
    "день": 86400,
    "дней": 86400,
    "н": 604800,
    "нед": 604800,
}

RP_ACTIONS = {
    "обнять": ("🤗", "обнял(а)"),
    "поцеловать": ("😘", "поцеловал(а)"),
    "ударить": ("👊", "ударил(а)"),
    "погладить": ("✋", "погладил(а)"),
    "кусь": ("🦷", "укусил(а)"),
    "шлёп": ("🖐", "шлёпнул(а)"),
    "пнуть": ("🦶", "пнул(а)"),
    "подарить": ("🎁", "подарил(а) подарок"),
    "кофе": ("☕", "угостил(а) кофе"),
}

# Команды без префикса — достаточно написать слово
PLAIN_COMMANDS = frozenset({
    "активировать", "activate", "деактивировать", "deactivate",
    "помощь", "help", "команды",
    "инфо", "info", "about", "правила", "rules",
    "профиль", "profile", "стата", "stats", "статистика",
    "баланс", "balance", "bal", "ежедневка", "ежедневный", "daily", "бонус",
    "мини", "mini", "miniapp", "mini_app", "перевод", "pay", "send", "дать", "передать",
    "выдать", "givecoins", "топ", "top",
    "карма", "karma", "kp", "игры", "games", "game",
    "геймпрофиль", "gameprofile", "gprofile",
    "магазин", "shop", "купить", "buy", "инвентарь", "inv", "inventory",
    "кнб", "rps", "рулетка", "roulette", "21", "blackjack",
    "ещё", "ещe", "hit", "стоп", "stand",
    "угадай", "guess", "лотерея", "lottery",
    "рыбалка", "fish", "шахта", "mine", "копать",
    "колесо", "wheel", "краш", "crash",
    "викторина", "quiz", "кейс", "case",
    "дартс", "darts", "баскет", "basketball", "футбол", "football",
    "боулинг", "bowling", "скачки", "race",
    "куб", "dice", "roll", "монетка", "coin", "flip",
    "слот", "slot", "дуэль", "duel",
    "бан", "ban", "разбан", "unban", "мут", "mute",
    "размут", "unmute", "кик", "kick", "варн", "warn",
    "снять", "удалить", "del",
    "приветствие", "welcome", "триггер", "trigger",
    "кто",
    "клан", "clan", "кланы", "clans",
    *RP_ACTIONS.keys(),
})

DIVIDER = games.DIVIDER


def strip_prefix(text: str) -> str:
    for p in PREFIXES:
        if text.startswith(p):
            return text[len(p) :].strip()
    return text.strip()


def sanitize_mini_app_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme == "https" and parsed.netloc and parsed.netloc not in {"localhost", "127.0.0.1"}:
        return url.rstrip("?")
    return "https://example.com/miniapp/"


async def build_mini_app_url(message: Message, uid: int, cid: int) -> str:
    user = await db.get_user(uid, cid) or {}
    inv = await db.get_inventory(uid, cid)
    level = int(user.get("level") or 1)
    xp = int(user.get("xp") or 0)
    xp_need = max(level * 100, 100)
    params = {
        "user_id": uid,
        "chat_id": cid,
        "name": (message.from_user.first_name if message.from_user else "Player").strip() or "Player",
        "balance": int(user.get("coins") or 0),
        "level": level,
        "xp": xp,
        "xp_need": xp_need,
        "streak": await db.get_daily_streak(uid, cid),
        "wins": int(user.get("wins") or 0),
        "karma": int(user.get("karma") or 0),
        "messages": int(user.get("messages") or 0),
        "vip": int(inv.get("vip", 0) > 0),
        "shield": int(inv.get("щит", 0) or 0),
        "inventory": json.dumps(inv, ensure_ascii=False),
    }
    if GAME_API_URL:
        params["api"] = GAME_API_URL
    clan = await db.get_user_clan(uid, cid)
    if clan:
        members = await db.get_clan_members(clan["clan_id"])
        role = await db.get_member_role(uid, cid)
        params.update({
            "clan_name": clan.get("name") or "",
            "clan_tag": clan.get("tag") or "",
            "clan_level": int(clan.get("level") or 1),
            "clan_coins": int(clan.get("coins") or 0),
            "clan_members": len(members),
            "clan_xp": int(clan.get("xp") or 0),
        })
        if role:
            params["clan_role"] = role
    base = sanitize_mini_app_url(MINI_APP_URL)
    return f"{base}?{urlencode(params)}"


def extract_command(text: str) -> str | None:
    """Распознать команду с префиксом или без."""
    raw = text.strip()
    if not raw:
        return None
    lower = raw.lower()

    if lower.startswith(PREFIXES) or lower.startswith("/"):
        return strip_prefix(lower)

    words = lower.split()
    if not words:
        return None

    if len(words) >= 2 and words[0] == "ежедневный" and words[1] == "бонус":
        return "ежедневка"

    if words[0] == "ежедневный":
        return "ежедневка"

    if words[0] in PLAIN_COMMANDS:
        return lower

    if len(words) >= 2 and words[0] == "кто" and words[1] == "я":
        return lower

    if len(words) >= 2 and words[0] == "снять" and words[1] == "варны":
        return lower

    if len(words) >= 2 and words[0] == "правила" and len(words) > 1:
        return lower

    return None


async def onboard_user(message: Message, chat_id: int, user_id: int) -> str | None:
    """Регистрация пользователя без автоматической выдачи founder item."""
    await db.register_global_user(user_id)
    return None


def parse_duration(raw: str) -> int | None:
    raw = raw.lower().strip()
    m = re.match(r"^(\d+)\s*(\S+)$", raw)
    if not m:
        return None
    num, unit = int(m.group(1)), m.group(2)
    sec = DURATION_MAP.get(unit)
    return num * sec if sec else None


def fmt_user(user) -> str:
    if user.username:
        return f"@{user.username}"
    return user.first_name or str(user.id)


async def is_admin(message: Message, user_id: int | None = None) -> bool:
    uid = user_id or (message.from_user.id if message.from_user else 0)
    try:
        member = await message.bot.get_chat_member(message.chat.id, uid)
        return member.status in (ChatMemberStatus.ADMINISTRATOR, ChatMemberStatus.CREATOR)
    except Exception:
        return False


async def is_bot_admin(message: Message) -> bool:
    try:
        me = await message.bot.get_me()
        member = await message.bot.get_chat_member(message.chat.id, me.id)
        return member.status in (ChatMemberStatus.ADMINISTRATOR, ChatMemberStatus.CREATOR)
    except Exception:
        return False


def parse_amount(args: list[str]) -> int | None:
    for arg in reversed(args):
        if arg.startswith("@"):
            continue
        try:
            amount = int(arg)
            if amount > 0:
                return amount
        except ValueError:
            continue
    return None


async def resolve_target(message: Message, args: list[str] | None = None) -> tuple[int, str] | None:
    args = args or []
    if message.reply_to_message and message.reply_to_message.from_user:
        u = message.reply_to_message.from_user
        if not u.is_bot:
            return u.id, fmt_user(u)
    if message.entities and message.text:
        for ent in message.entities:
            if ent.type == "text_mention" and ent.user:
                return ent.user.id, fmt_user(ent.user)
            if ent.type == "mention":
                username = message.text[ent.offset + 1 : ent.offset + ent.length].lower()
                found = await db.find_user_by_username(message.chat.id, username)
                if found:
                    name = f"@{found['username']}" if found.get("username") else found.get("first_name") or str(found["user_id"])
                    return found["user_id"], name
    for arg in args:
        if arg.startswith("@"):
            found = await db.find_user_by_username(message.chat.id, arg)
            if found:
                return found["user_id"], arg if arg.startswith("@") else f"@{arg.lstrip('@')}"
    return None


async def give_daily_bonus(message: Message, uid: int, cid: int) -> None:
    now = time.time()
    last = await db.get_last_daily_bonus(uid, cid)
    current_streak = await db.get_daily_streak(uid, cid)
    if last and now - last < 86400:
        left = int(86400 - (now - last))
        h, m = divmod(left // 60, 60)
        await message.reply(
            f"⏳ <b>Ежедневный бонус</b>\n"
            f"{DIVIDER}\n"
            f"Ты уже забирал сегодня!\n"
            f"Следующий через: <b>{h} ч {m} мин</b>",
            parse_mode=ParseMode.HTML,
        )
        return
    if last and 86400 <= now - last <= 172800:
        streak = current_streak + 1
    else:
        streak = 1
    base_bonus = random.randint(60, 220) + (streak - 1) * 35
    bonus = min(base_bonus + streak * 10, 500)
    bonus, extra = await games.apply_founder_bonus(uid, cid, bonus)
    total = await db.add_coins(uid, cid, bonus)
    lvl = await db.add_xp(uid, cid, 10 + streak * 2)
    await db.set_last_daily_bonus(uid, cid, now)
    await db.set_daily_streak(uid, cid, streak)
    tag = games.founder_tag(extra)
    levelup = f"\n🎉 Новый уровень: <b>{lvl['level']}</b>!" if lvl.get("level_up") else ""
    await message.reply(
        f"🎁 <b>Ежедневный бонус</b>\n"
        f"{DIVIDER}\n"
        f"├─ Серия: <b>{streak}</b> дней 🔁\n"
        f"├─ +<b>{bonus}</b> монет{tag}\n"
        f"├─ +<b>{10 + streak * 2}</b> XP\n"
        f"└─ 💰 Твой баланс: <b>{total}</b>{levelup}",
        parse_mode=ParseMode.HTML,
    )


async def transfer_coins(
    message: Message,
    uid: int,
    cid: int,
    args: list[str],
    *,
    admin_give: bool = False,
) -> None:
    amount = parse_amount(args)
    if amount is None:
        hint = (
            "<code>выдать 100</code> (ответом на сообщение)"
            if admin_give
            else "<code>дать 100</code> (ответом) или <code>дать @user 100</code>"
        )
        await message.reply(
            f"❌ <b>Не указана сумма</b>\n"
            f"{DIVIDER}\n"
            f"Формат: {hint}",
            parse_mode=ParseMode.HTML,
        )
        return

    target = await resolve_target(message, args)
    if not target:
        hint = "ответь на сообщение получателя" if admin_give else "ответь на сообщение или укажи @user"
        await message.reply(
            f"❌ <b>Получатель не найден</b>\n"
            f"{DIVIDER}\n"
            f"Как нужно: {hint}.",
            parse_mode=ParseMode.HTML,
        )
        return

    target_id, target_name = target
    if target_id == uid:
        await message.reply(
            f"❌ <b>Перевод не выполнен</b>\n"
            f"{DIVIDER}\n"
            f"Нельзя переводить монеты самому себе.",
            parse_mode=ParseMode.HTML,
        )
        return

    if admin_give:
        if not await is_admin(message):
            await message.reply(
                f"⛔ <b>Доступ запрещён</b>\n"
                f"{DIVIDER}\n"
                f"Команда только для администраторов чата.",
                parse_mode=ParseMode.HTML,
            )
            return
        new_bal = await db.add_coins(target_id, cid, amount)
        await message.reply(
            f"💎 <b>Админская выдача</b>\n"
            f"{DIVIDER}\n"
            f"├─ Получатель: {target_name}\n"
            f"├─ Выдано: <b>+{amount}</b> 🪙\n"
            f"└─ 💰 Баланс: <b>{new_bal}</b>",
            parse_mode=ParseMode.HTML,
        )
        return

    sender = await db.get_user(uid, cid)
    if sender["coins"] < amount:
        await message.reply(
            f"❌ <b>Недостаточно монет</b>\n"
            f"{DIVIDER}\n"
            f"├─ У тебя: <b>{sender['coins']}</b> 🪙\n"
            f"└─ Нужно: <b>{amount}</b> 🪙",
            parse_mode=ParseMode.HTML,
        )
        return

    await db.add_coins(uid, cid, -amount)
    new_bal = await db.add_coins(target_id, cid, amount)
    await message.reply(
        f"💸 <b>Перевод выполнен</b>\n"
        f"{DIVIDER}\n"
        f"├─ От: {fmt_user(message.from_user)}\n"
        f"├─ Кому: {target_name}\n"
        f"├─ Сумма: <b>{amount}</b> 🪙\n"
        f"└─ 💰 Баланс получателя: <b>{new_bal}</b>",
        parse_mode=ParseMode.HTML,
    )


# ── /start & help ──────────────────────────────────────────────

@router.message(CommandStart())
async def cmd_start(message: Message):
    kb = InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="📖 Помощь по командам", callback_data="help")],
            [InlineKeyboardButton(text="🎒 Посмотреть инвентарь", callback_data="inv_hint")],
            [
                InlineKeyboardButton(
                    text="➕ Добавить бота в группу",
                    url=f"https://t.me/{(await message.bot.get_me()).username}?startgroup=true",
                )
            ],
        ]
    )
    await message.answer(
        f"💎 <b>Добро пожаловать в {BOT_NAME}!</b>\n"
        f"{DIVIDER}\n\n"
        f"🛡 <b>Модерация</b> · 💰 <b>Экономика</b> · 🎮 <b>Игры</b> · 🏰 <b>Кланы</b>\n\n"
        f"👉 Добавь меня в группу и напиши <code>активировать</code>",
        parse_mode=ParseMode.HTML,
        reply_markup=kb,
    )


@router.message(Command("help", "помощь"))
async def cmd_help(message: Message):
    await send_help(message)


@router.callback_query(F.data == "help")
async def cb_help(callback):
    await send_help(callback.message, edit=True)
    await callback.answer()


@router.callback_query(F.data == "inv_hint")
async def cb_inv_hint(callback):
    await callback.message.answer(
        "🎒 <code>инвентарь</code>",
        parse_mode=ParseMode.HTML,
    )
    await callback.answer()


async def send_help(message: Message, edit: bool = False):
    text = (
        f"📖 <b>Помощь — {BOT_NAME}</b>\n"
        f"{DIVIDER}\n\n"
        f"<b>🔧 Настройка бота</b>\n"
        f"├─ <code>активировать</code> — включить бота в чате\n"
        f"└─ <code>деактивировать</code> — выключить бота\n\n"
        f"<b>⚖️ Модерация</b>\n"
        f"├─ <code>бан</code> <code>разбан</code> <code>мут</code> <code>размут</code>\n"
        f"├─ <code>кик</code> <code>варн</code> <code>снять варны</code>\n"
        f"└─ <code>удалить</code> — стереть сообщение (ответом)\n\n"
        f"<b>💰 Экономика</b>\n"
        f"├─ <code>баланс</code> — твои монеты и серия бонуса\n"
        f"├─ <code>ежедневный бонус</code> — ежедневка и серия\n"
        f"├─ <code>дать @user 100</code> — перевести монеты\n"
        f"├─ <code>выдать 100</code> — выдать (админ)\n"
        f"└─ <code>топ [coins/karma/msg/wins/level]</code> — рейтинг\n\n"
        f"<b>🏰 Кланы и битвы</b>\n"
        f"├─ <code>клан</code> — профиль своего клана\n"
        f"├─ <code>клан создать Название ТЕГ</code> — создать (500🪙)\n"
        f"├─ <code>клан топ</code> · <code>клан участники</code>\n"
        f"├─ <code>клан пригласить @user</code> · <code>клан принять</code>\n"
        f"└─ <code>клан битва ТЕГ 500</code> · <code>клан удар 70</code> — PvP\n\n"
        f"<b>❤️ RP-действия</b> (ответом на сообщение)\n"
        f"├─ <code>обнять</code> <code>поцеловать</code> <code>ударить</code>\n"
        f"├─ <code>погладить</code> <code>кусь</code> <code>шлёп</code> <code>пнуть</code>\n"
        f"└─ <code>подарить</code> <code>кофе</code>\n\n"
        f"<b>🎮 Игры и магазин</b>\n"
        f"├─ <code>игры</code> — весь список игр\n"
        f"├─ <code>магазин</code> · <code>купить предмет</code>\n"
        f"└─ <code>инвентарь</code> — твои вещи\n\n"
        f"<b>📊 Информация</b>\n"
        f"├─ <code>профиль</code> · <code>кто @user</code> · <code>стата</code>\n"
        f"├─ <code>инфо</code> — о боте и чате\n"
        f"└─ <code>правила</code> — правила чата"
    )
    if edit:
        await message.edit_text(text, parse_mode=ParseMode.HTML)
    else:
        await message.answer(text, parse_mode=ParseMode.HTML)


# ── Welcome ────────────────────────────────────────────────────

@router.chat_member()
async def on_member_update(event: ChatMemberUpdated):
    if event.chat.type not in (ChatType.GROUP, ChatType.SUPERGROUP):
        return
    old = event.old_chat_member.status
    new = event.new_chat_member.status
    if old in ("left", "kicked") and new == "member":
        chat = await db.get_chat(event.chat.id)
        if chat and chat["active"]:
            user = event.new_chat_member.user
            await db.ensure_user(user.id, event.chat.id, user.username, user.first_name)
            founder_msg = await onboard_user_from_event(event, user.id)
            welcome = chat["welcome"].replace("{name}", user.first_name or "друг")
            text = (
                f"✨ <b>{DIVIDER}</b>\n"
                f"{welcome}\n"
                f"✨ <b>{DIVIDER}</b>"
            )
            await event.bot.send_message(event.chat.id, text, parse_mode=ParseMode.HTML)
            if founder_msg:
                await event.bot.send_message(event.chat.id, founder_msg, parse_mode=ParseMode.HTML)


async def onboard_user_from_event(event: ChatMemberUpdated, user_id: int) -> str | None:
    await db.register_global_user(user_id)
    return None


# ── Main message handler ───────────────────────────────────────

@router.message(F.text)
async def handle_text(message: Message):
    if not message.from_user or message.from_user.is_bot:
        return

    text = message.text or ""
    chat_id = message.chat.id
    user_id = message.from_user.id

    # Private chat — commands + trivia
    if message.chat.type == ChatType.PRIVATE:
        await db.ensure_chat(user_id)
        await db.ensure_user(user_id, user_id, message.from_user.username, message.from_user.first_name)
        founder_msg = await onboard_user(message, user_id, user_id)
        if founder_msg:
            await message.answer(founder_msg, parse_mode=ParseMode.HTML)

        cmd = extract_command(text)
        if cmd:
            await handle_command(message, cmd)
        else:
            trivia = await games.check_trivia(user_id, user_id, text)
            if trivia:
                await message.reply(trivia, parse_mode=ParseMode.HTML)
        return

    await db.ensure_chat(chat_id)
    await db.ensure_user(user_id, chat_id, message.from_user.username, message.from_user.first_name)

    chat = await db.get_chat(chat_id)
    if not chat or not chat["active"]:
        cmd_lower = text.lower().strip()
        if cmd_lower in ("активировать", "activate") or cmd_lower.startswith(("!активировать", "/activate")):
            if await is_admin(message):
                await db.set_chat_active(chat_id, True)
                await message.reply(
                    f"✅ <b>{BOT_NAME}</b> активирован\n"
                    f"{DIVIDER}\n"
                    "<code>помощь</code> · выдай боту права админа",
                    parse_mode=ParseMode.HTML,
                )
            else:
                await message.reply("❌ Только администратор может активировать бота.")
        return

    founder_msg = await onboard_user(message, chat_id, user_id)
    if founder_msg:
        await message.reply(founder_msg, parse_mode=ParseMode.HTML)
    else:
        await db.sync_founder_item(user_id, chat_id)

    # Check mute
    mute_until = await db.get_mute_until(user_id, chat_id)
    if mute_until and time.time() < mute_until:
        try:
            await message.delete()
        except Exception:
            pass
        return
    elif mute_until:
        await db.clear_mute(user_id, chat_id)

    # Antiflood
    if chat["antiflood"]:
        if not await check_flood(message, chat["flood_limit"]):
            return

    await db.inc_messages(user_id, chat_id)

    # Commands (с префиксом или без)
    cmd = extract_command(text)
    if cmd:
        await handle_command(message, cmd)
        return

    # Triggers
    trigger = await db.find_trigger(chat_id, text)
    if trigger:
        await message.reply(trigger)
        return

    # Trivia answer
    trivia = await games.check_trivia(user_id, chat_id, text)
    if trivia:
        await message.reply(trivia, parse_mode=ParseMode.HTML)


async def check_flood(message: Message, limit: int) -> bool:
    chat_id = message.chat.id
    user_id = message.from_user.id
    now = time.time()
    bucket = _flood.setdefault(chat_id, {}).setdefault(user_id, [])
    bucket[:] = [t for t in bucket if now - t < 5]
    bucket.append(now)
    if len(bucket) > limit and not await is_admin(message):
        try:
            await message.delete()
        except Exception:
            pass
        if len(bucket) == limit + 1:
            await message.answer(f"⚠️ {fmt_user(message.from_user)}, не флуди!")
        return False
    return True


# ── Command dispatcher ─────────────────────────────────────────

async def handle_command(message: Message, cmd: str):
    parts = cmd.split(maxsplit=3)
    command = parts[0] if parts else ""
    args = parts[1:] if len(parts) > 1 else []
    uid = message.from_user.id
    cid = message.chat.id

    # Ensure user exists for game/economy commands in private chat
    if message.chat.type == ChatType.PRIVATE:
        await db.ensure_chat(uid)  # use user_id as pseudo chat for PM stats
        await db.ensure_user(uid, uid, message.from_user.username, message.from_user.first_name)
        cid = uid

    # Activation
    if command in ("активировать", "activate"):
        if message.chat.type == ChatType.PRIVATE:
            await message.answer("Добавьте меня в группу и активируйте там.")
            return
        if await is_admin(message):
            await db.set_chat_active(message.chat.id, True)
            await message.reply(
                f"✅ <b>{BOT_NAME}</b> активирован\n{DIVIDER}\n<code>помощь</code>",
                parse_mode=ParseMode.HTML,
            )
        else:
            await message.reply("❌ Только для администраторов.")
        return

    if command in ("деактивировать", "deactivate"):
        if await is_admin(message):
            await db.set_chat_active(message.chat.id, False)
            await message.reply("🔴 Бот деактивирован.")
        return

    if command in ("помощь", "help", "команды"):
        await send_help(message)
        return

    # Info
    if command in ("инфо", "info", "about"):
        count = await message.bot.get_chat_member_count(message.chat.id)
        remaining = await db.founders_remaining()
        await message.reply(
            f"💎 <b>Информация о боте</b>\n"
            f"{DIVIDER}\n"
            f"├─ Название: <b>{BOT_NAME}</b> × <b>РЕРЕ</b>\n"
            f"├─ Участников в чате: <b>{count}</b>\n"
            f"└─ Брелков РЕРЕ свободно: <b>{remaining}</b> из 50\n\n"
            f"🛡 Модерация · 💰 Экономика · 🎮 Игры · 🏰 Кланы",
            parse_mode=ParseMode.HTML,
        )
        return

    if command in ("правила", "rules"):
        chat = await db.get_chat(message.chat.id)
        rules = chat["rules"] if chat else "Правила не заданы."
        await message.reply(
            f"📜 <b>Правила чата</b>\n"
            f"{DIVIDER}\n\n{rules}\n\n"
            f"<i>Забанить за нарушения может только администратор.</i>",
            parse_mode=ParseMode.HTML,
        )
        return

    if command in ("профиль", "profile") or (command == "кто" and args):
        target_id = uid
        target_name = fmt_user(message.from_user)
        if command == "кто" and args:
            t = await resolve_target(message, args)
            if t:
                target_id, target_name = t
        user = await db.get_user(target_id, cid)
        if not user:
            await message.reply(
                f"🔍 <b>Пользователь не найден</b>\n"
                f"{DIVIDER}\n"
                f"Возможно, он ещё не писал в этом чате.",
                parse_mode=ParseMode.HTML,
            )
            return
        lvl = user.get("level", 1)
        xp = user.get("xp", 0)
        needed = lvl * 100
        inv = await db.get_inventory(target_id, cid)
        founder_badge = " 🔑" if inv.get(FOUNDER_ITEM, 0) > 0 else ""
        vip_badge = " 💎" if inv.get("vip", 0) > 0 else ""
        shield = " 🛡" if inv.get("щит", 0) > 0 else ""
        badges = founder_badge + vip_badge + shield
        clan = await db.get_user_clan(target_id, cid)
        clan_line = f"\n├─ 🏰 Клан: <b>[{clan['tag']}]</b> {clan['name']}" if clan else ""
        role_line = ""
        if clan:
            r = await db.get_member_role(target_id, cid)
            if r:
                role_line = f" <i>({ROLE_NAMES.get(r, '')})</i>"
                clan_line += role_line
        wins = user.get("wins", 0)
        losses = user.get("losses", 0)
        wr = f" (WR {wins / max(1, wins + losses) * 100:.0f}%)" if wins + losses else ""
        await message.reply(
            f"✨ <b>{target_name}</b>{badges}\n"
            f"{DIVIDER}\n"
            f"🎮 Ур. {lvl} — {games.level_title(lvl)} ({xp}/{needed} XP)\n"
            f"💰 Монеты: <b>{user['coins']}</b>\n"
            f"⭐ Карма: <b>{user['karma']}</b> KP\n"
            f"⚠️ Варны: <b>{user['warns']}</b>/3\n"
            f"💬 Сообщений: <b>{user['messages']}</b>\n"
            f"🏆 Побед: {wins} · Поражений: {losses}{wr}{clan_line}",
            parse_mode=ParseMode.HTML,
        )
        return

    if command == "кто" and args and args[0] == "я":
        user = await db.get_user(uid, cid)
        inv = await db.get_inventory(uid, cid)
        lvl = user.get("level", 1)
        clan = await db.get_user_clan(uid, cid)
        clan_line = f"\n├─ 🏰 <b>[{clan['tag']}]</b> {clan['name']}" if clan else ""
        founder = f"\n└─ 🔑 <i>+{int(FOUNDER_PROFIT_BONUS * 100)}% к прибыли</i>" if inv.get(FOUNDER_ITEM, 0) > 0 else ""
        badges = []
        if inv.get(FOUNDER_ITEM, 0) > 0:
            badges.append("🔑")
        if inv.get("vip", 0) > 0:
            badges.append("💎")
        badges_line = " " + " ".join(badges) if badges else ""
        await message.reply(
            f"🪞 <b>Твой профиль</b>\n"
            f"{DIVIDER}\n"
            f"👤 {fmt_user(message.from_user)}{badges_line}\n"
            f"🎮 Ур. {lvl} — {games.level_title(lvl)}\n"
            f"💰 Баланс: <b>{user['coins']}</b> монет\n"
            f"⭐ Карма: <b>{user['karma']}</b> KP{clan_line}{founder}",
            parse_mode=ParseMode.HTML,
        )
        return

    if command in ("стата", "stats", "статистика"):
        user = await db.get_user(uid, cid)
        wins = user.get("wins", 0)
        losses = user.get("losses", 0)
        wr = f"{wins / max(1, wins + losses) * 100:.0f}%" if wins + losses else "—"
        clan = await db.get_user_clan(uid, cid)
        clan_line = f"\n└─ 🏰 Клан: <b>[{clan['tag']}]</b>" if clan else ""
        await message.reply(
            f"📊 <b>Статистика — {fmt_user(message.from_user)}</b>\n"
            f"{DIVIDER}\n"
            f"💬 Сообщений: <b>{user['messages']}</b>\n"
            f"💰 Монет заработано: <b>{user['coins']}</b>\n"
            f"⭐ Карма: <b>{user['karma']}</b> KP\n"
            f"🎮 Игр сыграно: <b>{user.get('games_played', 0)}</b>\n"
            f"🏆 Победы: {wins} · Поражения: {losses} (WR {wr}){clan_line}",
            parse_mode=ParseMode.HTML,
        )
        return

    # Economy
    if command in ("баланс", "balance", "bal"):
        user = await db.get_user(uid, cid)
        inv = await db.get_inventory(uid, cid)
        extras = []
        if inv.get(FOUNDER_ITEM, 0) > 0:
            extras.append("🔑")
        if inv.get("vip", 0) > 0:
            extras.append("💎")
        extras_line = " " + " ".join(extras) if extras else ""
        clan = await db.get_user_clan(uid, cid)
        clan_line = f"\n└─ 🏰 Казна клана: <b>{clan['coins']}</b>" if clan else ""
        streak = await db.get_daily_streak(uid, cid)
        next_bonus = 60 + max(streak - 1, 0) * 35
        await message.reply(
            f"💰 <b>Баланс — {fmt_user(message.from_user)}</b>{extras_line}\n"
            f"{DIVIDER}\n"
            f"├─ 🪙 <b>{user['coins']}</b> монет\n"
            f"├─ 🔁 Серия: <b>{streak}</b> дней\n"
            f"├─ 🎁 Следующий бонус: +<b>{next_bonus}</b> 🪙\n"
            f"└─ ⭐ Карма: <b>{user['karma']}</b> KP{clan_line}",
            parse_mode=ParseMode.HTML,
        )
        return

    if command in ("ежедневка", "daily", "бонус", "ежедневный"):
        await give_daily_bonus(message, uid, cid)
        return

    if command in ("мини", "mini", "miniapp", "mini_app"):
        mini_url = await (
            build_mini_app_url(message, uid, cid)
            if not message.chat.type == ChatType.PRIVATE
            else build_mini_app_url(message, uid, uid)
        )
        keyboard = InlineKeyboardMarkup(
            inline_keyboard=[
                [
                    InlineKeyboardButton(
                        text="🚀 Открыть Mini App",
                        web_app=WebAppInfo(url=mini_url),
                    )
                ]
            ]
        )
        await message.reply(
            f"📱 <b>Mini App</b>\n{DIVIDER}\n"
            f"Открыть приложение в Telegram:",
            parse_mode=ParseMode.HTML,
            reply_markup=keyboard,
        )
        return

    if command in ("перевод", "pay", "send", "дать", "передать"):
        await transfer_coins(message, uid, cid, args)
        return

    if command in ("выдать", "givecoins"):
        await transfer_coins(message, uid, cid, args, admin_give=True)
        return

    if command in ("топ", "top"):
        field = "coins"
        label_name = "Монеты"
        if args and args[0] in ("карма", "karma", "kp"):
            field = "karma"
            label_name = "Карма"
        elif args and args[0] in ("сообщ", "msg", "messages"):
            field = "messages"
            label_name = "Сообщения"
        elif args and args[0] in ("игры", "games", "wins", "побед"):
            field = "wins"
            label_name = "Победы"
        elif args and args[0] in ("уровень", "level", "lvl"):
            field = "level"
            label_name = "Уровень"
        leaders = await db.top_users(cid, field)
        if not leaders:
            await message.reply(
                f"🏆 <b>Рейтинг — {label_name}</b>\n"
                f"{DIVIDER}\n"
                f"Пока нет активных участников.",
                parse_mode=ParseMode.HTML,
            )
            return
        labels = {"coins": "🪙", "karma": "⭐", "messages": "💬", "wins": "🏆", "level": "🎮", "xp": "⭐"}
        lines = [f"🏆 <b>Рейтинг — {label_name}</b>\n{DIVIDER}\n"]
        for i, u in enumerate(leaders, 1):
            name = (u["username"] and f"@{u['username']}") or u["first_name"] or f"<i>ID{u['user_id']}</i>"
            medal = ["🥇", "🥈", "🥉"][i - 1] if i <= 3 else f"<b>{i}.</b>"
            lines.append(f"{medal} {name} — <b>{u['score']}</b> {labels.get(field, '')}")
        await message.reply("\n".join(lines), parse_mode=ParseMode.HTML)
        return

    if command in ("кarma", "карма", "kp"):
        target = await resolve_target(message)
        if not target:
            await message.reply(
                f"⭐ <b>Изменение кармы</b>\n"
                f"{DIVIDER}\n"
                f"❌ Ответь на сообщение участника, кому меняем карму.",
                parse_mode=ParseMode.HTML,
            )
            return
        target_id, target_name = target
        amount = 1
        if args:
            try:
                amount = int(args[0])
                if amount > 50:
                    amount = 50
                if amount < -50:
                    amount = -50
            except ValueError:
                pass
        total = await db.add_karma(target_id, message.chat.id, amount)
        emoji = "⬆️" if amount > 0 else "⬇️"
        arrow = "+" if amount > 0 else ""
        await message.reply(
            f"⭐ <b>Карма изменена</b>\n"
            f"{DIVIDER}\n"
            f"├─ Кому: {target_name}\n"
            f"├─ Изменение: {emoji} {arrow}<b>{amount}</b> KP\n"
            f"└─ Всего: <b>{total}</b> KP",
            parse_mode=ParseMode.HTML,
        )
        return

    # ── Games menu ──
    if command in ("игры", "games", "game"):
        await message.reply(games.games_help(), parse_mode=ParseMode.HTML)
        return

    if command in ("геймпрофиль", "gameprofile", "gprofile"):
        text = await games.show_game_profile(uid, cid, fmt_user(message.from_user))
        await message.reply(text, parse_mode=ParseMode.HTML)
        return

    if command in ("магазин", "shop"):
        await message.reply(await games.show_shop(), parse_mode=ParseMode.HTML)
        return

    if command in ("купить", "buy"):
        await message.reply(await games.buy_item(uid, cid, args), parse_mode=ParseMode.HTML)
        return

    if command in ("инвентарь", "inv", "inventory"):
        await message.reply(await games.show_inventory(uid, cid), parse_mode=ParseMode.HTML)
        return

    game_cmds = {
        "кнб": lambda: games.play_rps(uid, cid, args),
        "rps": lambda: games.play_rps(uid, cid, args),
        "рулетка": lambda: games.play_roulette(uid, cid, args),
        "roulette": lambda: games.play_roulette(uid, cid, args),
        "21": lambda: games.play_blackjack(uid, cid, args),
        "blackjack": lambda: games.play_blackjack(uid, cid, args),
        "ещё": lambda: games.blackjack_hit(uid, cid),
        "ещe": lambda: games.blackjack_hit(uid, cid),
        "hit": lambda: games.blackjack_hit(uid, cid),
        "стоп": lambda: games.blackjack_stand(uid, cid),
        "stand": lambda: games.blackjack_stand(uid, cid),
        "угадай": lambda: games.play_guess(uid, cid, args),
        "guess": lambda: games.play_guess(uid, cid, args),
        "лотерея": lambda: games.play_lottery(uid, cid, args),
        "lottery": lambda: games.play_lottery(uid, cid, args),
        "рыбалка": lambda: games.play_fish(uid, cid),
        "fish": lambda: games.play_fish(uid, cid),
        "шахта": lambda: games.play_mine(uid, cid),
        "mine": lambda: games.play_mine(uid, cid),
        "копать": lambda: games.play_mine(uid, cid),
        "колесо": lambda: games.play_wheel(uid, cid, args),
        "wheel": lambda: games.play_wheel(uid, cid, args),
        "краш": lambda: games.play_crash(uid, cid, args),
        "crash": lambda: games.play_crash(uid, cid, args),
        "викторина": lambda: games.play_trivia(uid, cid),
        "quiz": lambda: games.play_trivia(uid, cid),
        "кейс": lambda: games.play_case(uid, cid, args),
        "case": lambda: games.play_case(uid, cid, args),
        "дартс": lambda: games.play_darts(uid, cid),
        "darts": lambda: games.play_darts(uid, cid),
        "баскет": lambda: games.play_basketball(uid, cid),
        "basketball": lambda: games.play_basketball(uid, cid),
        "футбол": lambda: games.play_football(uid, cid),
        "football": lambda: games.play_football(uid, cid),
        "боулинг": lambda: games.play_bowling(uid, cid, args),
        "bowling": lambda: games.play_bowling(uid, cid, args),
        "скачки": lambda: games.play_race(uid, cid, args),
        "race": lambda: games.play_race(uid, cid, args),
    }

    if command in game_cmds:
        result = await game_cmds[command]()
        await message.reply(result, parse_mode=ParseMode.HTML)
        return

    # Classic games
    if command in ("куб", "dice", "roll"):
        dice_msg = await message.reply_dice(emoji="🎲")
        n = dice_msg.dice.value
        reward = n * 5
        text = await games._reward(uid, cid, games.GameResult(f"🎲 Выпало: {n}\n+{reward} монет", reward, xp_delta=5, win=n >= 4))
        await message.reply(text, parse_mode=ParseMode.HTML)
        return

    if command in ("монетка", "coin", "flip"):
        side = random.choice(["орёл 🦅", "решка 🪙"])
        pick = args[0].lower() if args else None
        if pick in ("орёл", "орел", "heads", "о"):
            win = side.startswith("ор")
        elif pick in ("решка", "tails", "р"):
            win = side.startswith("реш")
        else:
            await message.reply(f"🪙 {side}\n\nУкажи сторону: <code>монетка [орёл/решка] [ставка]</code>")
            return
        bet = 30
        if len(args) > 1:
            try:
                bet = int(args[1])
            except ValueError:
                pass
        err = await games._charge(uid, cid, bet)
        if err:
            await message.reply(err)
            return
        if win:
            text = await games._reward(uid, cid, games.GameResult(f"🪙 {side}\n✅ Угадал! +{bet*2}", bet * 2, xp_delta=10, win=True))
        else:
            text = await games._reward(uid, cid, games.GameResult(f"🪙 {side}\n❌ Не угадал. -{bet}", xp_delta=5, win=False))
        await message.reply(text, parse_mode=ParseMode.HTML)
        return

    if command in ("слот", "slot"):
        symbols = ["🍒", "🍋", "💎", "7️⃣", "⭐"]
        inv = await db.get_inventory(uid, cid)
        if inv.get("клевер", 0) > 0:
            reels = [random.choice(symbols[:3])] * 3
            await games._use_item(uid, cid, "клевер")
            clover = " 🍀"
        else:
            reels = [random.choice(symbols) for _ in range(3)]
            clover = ""
        result = " | ".join(reels)
        two = reels[0] == reels[1] or reels[1] == reels[2] or reels[0] == reels[2]
        win = reels[0] == reels[1] == reels[2]
        if win:
            prize = 150 if reels[0] == "💎" else 100
            text = await games._reward(uid, cid, games.GameResult(f"🎰 {result}{clover}\n🎉 ДЖЕКПОТ! +{prize}", prize, xp_delta=15, win=True))
        elif two:
            text = await games._reward(uid, cid, games.GameResult(f"🎰 {result}{clover}\n✨ Два совпадения! +20", 20, xp_delta=8, win=True))
        else:
            text = await games._reward(uid, cid, games.GameResult(f"🎰 {result}{clover}\n😔 Не повезло...", xp_delta=3, win=False))
        await message.reply(text, parse_mode=ParseMode.HTML)
        return

    if command in ("дуэль", "duel"):
        target = await resolve_target(message)
        if not target:
            await message.reply(
                f"⚔️ <b>Дуэль</b>\n"
                f"{DIVIDER}\n"
                f"❌ Ответь на сообщение соперника, которого вызываешь!\n\n"
                f"Формат: <code>дуэль [ставка]</code> (ответом)",
                parse_mode=ParseMode.HTML,
            )
            return
        target_id, target_name = target
        bet = 50
        if args:
            try:
                bet = int(args[0])
                if bet < 0:
                    bet = 0
            except ValueError:
                pass
        p1 = await db.get_user(uid, cid)
        p2 = await db.get_user(target_id, cid)
        if p1["coins"] < bet or p2["coins"] < bet:
            await message.reply(
                f"⚔️ <b>Дуэль отменена</b>\n"
                f"{DIVIDER}\n"
                f"❌ Недостаточно монет у одного из игроков.\n"
                f"├─ У тебя: <b>{p1['coins']}</b> 🪙\n"
                f"└─ У {target_name}: <b>{p2['coins']}</b> 🪙\n\n"
                f"Нужно минимум по <b>{bet}</b> 🪙 каждому.",
                parse_mode=ParseMode.HTML,
            )
            return
        score1, score2 = random.randint(1, 100), random.randint(1, 100)
        if score1 > score2:
            await db.add_coins(uid, cid, bet)
            await db.add_coins(target_id, cid, -bet)
            await db.record_game(uid, cid, True)
            await db.record_game(target_id, cid, False)
            await db.add_xp(uid, cid, 20)
            winner = fmt_user(message.from_user)
            winner_id = uid
        elif score2 > score1:
            await db.add_coins(uid, cid, -bet)
            await db.add_coins(target_id, cid, bet)
            await db.record_game(uid, cid, False)
            await db.record_game(target_id, cid, True)
            await db.add_xp(target_id, cid, 20)
            winner = target_name
            winner_id = target_id
        else:
            winner = "ничья"
            winner_id = None
        if winner == "ничья":
            result_line = f"🤝 <b>НИЧЬЯ!</b>\nОба получили по {score1} очков. Ставки возвращены."
        else:
            result_line = f"🏆 <b>Победитель: {winner}</b>\nВыигрыш: +<b>{bet}</b> 🪙 · +20 XP"
        p1_final = (await db.get_user(uid, cid))["coins"]
        p2_final = (await db.get_user(target_id, cid))["coins"]
        await message.reply(
            f"⚔️ <b>Дуэль состоялаcь!</b>\n"
            f"{DIVIDER}\n"
            f"🎯 {fmt_user(message.from_user)}: <b>{score1}</b> · 💰 {p1_final}\n"
            f"🎯 {target_name}: <b>{score2}</b> · 💰 {p2_final}\n"
            f"{DIVIDER}\n"
            f"{result_line}",
            parse_mode=ParseMode.HTML,
        )
        return

    # ── Кланы ──
    if command in ("клан", "clan", "кланы", "clans"):
        await handle_clan(message, args, uid, cid)
        return

    # RP
    if command in RP_ACTIONS:
        target = await resolve_target(message)
        if not target:
            await message.reply(
                f"❤️ <b>RP-действие</b>\n{DIVIDER}\n"
                f"❌ Ответь на сообщение пользователя!",
                parse_mode=ParseMode.HTML,
            )
            return
        emoji, action = RP_ACTIONS[command]
        _, target_name = target
        await message.reply(
            f"{emoji} <b>RP</b>\n{DIVIDER}\n"
            f"{fmt_user(message.from_user)} <b>{action}</b> {target_name}",
            parse_mode=ParseMode.HTML,
        )
        return

    # Moderation
    mod_cmds = {
        "бан": "ban", "ban": "ban",
        "разбан": "unban", "unban": "unban",
        "мут": "mute", "mute": "mute",
        "размут": "unmute", "unmute": "unmute",
        "кик": "kick", "kick": "kick",
        "варн": "warn", "warn": "warn",
        "снять": "unwarn", "удалить": "del",
    }

    if command in mod_cmds or (command == "снять" and args and args[0] == "варны"):
        if not await is_admin(message):
            await message.reply(
                f"⚖️ <b>Модерация</b>\n{DIVIDER}\n"
                f"⛔ Доступ запрещён — только для администраторов.",
                parse_mode=ParseMode.HTML,
            )
            return
        if not await is_bot_admin(message):
            await message.reply(
                f"⚠️ <b>Нет прав!</b>\n"
                f"Выдайте боту права администратора, чтобы он мог мутить/банить.",
                parse_mode=ParseMode.HTML,
            )
            return

        action = mod_cmds.get(command, "unwarn" if command == "снять" else command)
        target = await resolve_target(message)
        duration = parse_duration(args[0]) if args else None

        if action == "del":
            if message.reply_to_message:
                try:
                    await message.reply_to_message.delete()
                    await message.delete()
                except Exception:
                    await message.reply(
                        f"🗑️ <b>Удаление сообщения</b>\n{DIVIDER}\n❌ Не удалось удалить.",
                        parse_mode=ParseMode.HTML,
                    )
            return

        if action in ("ban", "mute", "kick", "warn", "unwarn", "unban", "unmute") and not target:
            await message.reply(
                f"⚖️ <b>Модерация</b>\n{DIVIDER}\n"
                f"❌ Ответь на сообщение нарушителя!",
                parse_mode=ParseMode.HTML,
            )
            return

        target_id, target_name = target

        if action == "ban":
            until = datetime.now() + timedelta(seconds=duration) if duration else None
            await message.bot.ban_chat_member(message.chat.id, target_id, until_date=until)
            dur_text = f"на <b>{args[0]}</b>" if duration else "<b>навсегда</b>"
            await message.reply(
                f"🔨 <b>БАН</b>\n{DIVIDER}\n"
                f"👤 Нарушитель: {target_name}\n"
                f"⏱️ Срок: {dur_text}",
                parse_mode=ParseMode.HTML,
            )

        elif action == "unban":
            await message.bot.unban_chat_member(message.chat.id, target_id, only_if_banned=True)
            await message.reply(
                f"✅ <b>Разбан</b>\n{DIVIDER}\n"
                f"🎉 {target_name} снова в чате!",
                parse_mode=ParseMode.HTML,
            )

        elif action == "mute":
            until_ts = time.time() + (duration or 3600)
            await db.set_mute(target_id, message.chat.id, until_ts)
            try:
                until_dt = datetime.fromtimestamp(until_ts)
                await message.bot.restrict_chat_member(
                    message.chat.id, target_id,
                    permissions=None,
                    until_date=until_dt,
                )
            except Exception:
                pass
            dur_text = f"<b>{args[0]}</b>" if duration else "<b>1 час</b>"
            await message.reply(
                f"🔇 <b>МУТ</b>\n{DIVIDER}\n"
                f"👤 {target_name}\n"
                f"⏱️ На {dur_text} 🤐",
                parse_mode=ParseMode.HTML,
            )

        elif action == "unmute":
            await db.clear_mute(target_id, message.chat.id)
            try:
                from aiogram.types import ChatPermissions
                await message.bot.restrict_chat_member(
                    message.chat.id, target_id,
                    permissions=ChatPermissions(
                        can_send_messages=True,
                        can_send_audios=True,
                        can_send_documents=True,
                        can_send_photos=True,
                        can_send_videos=True,
                        can_send_video_notes=True,
                        can_send_voice_notes=True,
                        can_send_polls=True,
                        can_send_other_messages=True,
                        can_add_web_page_previews=True,
                    ),
                )
            except Exception:
                pass
            await message.reply(
                f"🔊 <b>Размут</b>\n{DIVIDER}\n"
                f"🎉 {target_name}, снова можно говорить!",
                parse_mode=ParseMode.HTML,
            )

        elif action == "kick":
            await message.bot.ban_chat_member(message.chat.id, target_id)
            await message.bot.unban_chat_member(message.chat.id, target_id)
            await message.reply(
                f"👢 <b>КИК</b>\n{DIVIDER}\n"
                f"{target_name} удалён из чата.",
                parse_mode=ParseMode.HTML,
            )

        elif action == "warn":
            warns = await db.add_warn(target_id, message.chat.id)
            await message.reply(
                f"⚠️ <b>ВАРН</b>\n{DIVIDER}\n"
                f"👤 {target_name}\n"
                f"🚩 <b>{warns}</b>/3 варнов",
                parse_mode=ParseMode.HTML,
            )
            if warns >= 3:
                await message.bot.ban_chat_member(message.chat.id, target_id)
                await db.reset_warns(target_id, message.chat.id)
                await message.reply(
                    f"🔨 <b>АВТО-БАН!</b>\n{DIVIDER}\n"
                    f"{target_name} получил 3 варна и забанен.",
                    parse_mode=ParseMode.HTML,
                )

        elif action == "unwarn":
            await db.reset_warns(target_id, message.chat.id)
            await message.reply(
                f"✅ <b>Варны сняты</b>\n{DIVIDER}\n"
                f"👤 {target_name} — чист перед законом.",
                parse_mode=ParseMode.HTML,
            )
        return

    # Admin settings
    if command in ("приветствие", "welcome") and args:
        if not await is_admin(message):
            return
        text = " ".join(args).replace("{name}", "{name}")
        async with __import__("aiosqlite").connect(__import__("config").DB_PATH) as conn:
            await conn.execute("UPDATE chats SET welcome = ? WHERE chat_id = ?", (text, message.chat.id))
            await conn.commit()
        await message.reply(
            f"👋 <b>Приветствие обновлено!</b>\n"
            f"{DIVIDER}\n"
            f"📝 Текст:\n<i>{text[:200]}{'...' if len(text)>200 else ''}</i>\n\n"
            f"<i>Используй {{name}} для подстановки имени участника.</i>",
            parse_mode=ParseMode.HTML,
        )
        return

    if command == "правила" and len(args) >= 1 and " ".join(args) != "":
        if not await is_admin(message):
            return
        rules_text = " ".join(args)
        async with __import__("aiosqlite").connect(__import__("config").DB_PATH) as conn:
            await conn.execute("UPDATE chats SET rules = ? WHERE chat_id = ?", (rules_text, message.chat.id))
            await conn.commit()
        await message.reply(
            f"📜 <b>Правила обновлены!</b>\n"
            f"{DIVIDER}\n"
            f"Посмотреть: <code>правила</code>\n\n"
            f"<i>Текст: {rules_text[:120]}{'...' if len(rules_text)>120 else ''}</i>",
            parse_mode=ParseMode.HTML,
        )
        return

    if command in ("триггер", "trigger") and args:
        if not await is_admin(message):
            return
        raw = " ".join(args)
        if "|" not in raw:
            await message.reply(
                f"🎯 <b>Триггеры</b>\n{DIVIDER}\n"
                f"❌ Неверный формат!\n\n"
                f"Правильно: <code>триггер слово | ответ</code>",
                parse_mode=ParseMode.HTML,
            )
            return
        keyword, response = [p.strip() for p in raw.split("|", 1)]
        await db.add_trigger(message.chat.id, keyword, response)
        await message.reply(
            f"🎯 <b>Триггер добавлен!</b>\n"
            f"{DIVIDER}\n"
            f"📝 Ключ: <code>{keyword}</code>\n"
            f"💬 Ответ: {response[:80]}{'...' if len(response)>80 else ''}",
            parse_mode=ParseMode.HTML,
        )
        return


CLAN_CREATE_COST = 500
ROLE_NAMES = {"owner": "👑 Лидер", "officer": "⭐ Офицер", "member": "👤 Участник"}


def _clan_tag(tag: str) -> str:
    t = tag.upper().strip()
    if len(t) > 6:
        t = t[:6]
    return t


async def handle_clan(message: Message, args: list[str], uid: int, cid: int):
    sub = args[0].lower() if args else "профиль"

    # ── Топ кланов ──
    if sub in ("список", "лист", "топ", "list", "top", "рейтинг"):
        field = "coins"
        label_name = "Казна"
        if len(args) > 1:
            f = args[1].lower()
            if f in ("уровень", "lvl", "level"):
                field = "level"
                label_name = "Уровень"
            elif f in ("победы", "wins", "винс"):
                field = "wins"
                label_name = "Победы"
            elif f in ("опыт", "xp"):
                field = "xp"
                label_name = "Опыт"
        clans = await db.top_clans(cid, field)
        if not clans:
            await message.reply(
                f"� <b>Рейтинг кланов — {label_name}</b>\n"
                f"{DIVIDER}\n"
                f"� Пока нет кланов — создай первый!",
                parse_mode=ParseMode.HTML,
            )
            return
        labels = {"coins": "🪙", "level": "🎮", "wins": "🏆", "xp": "⭐"}
        lines = [f"🏆 <b>Рейтинг кланов — {label_name}</b>\n{DIVIDER}\n"]
        for i, c in enumerate(clans, 1):
            medal = ["🥇", "🥈", "🥉"][i - 1] if i <= 3 else f"<b>{i}.</b>"
            lines.append(
                f"{medal} [<b>{c['tag']}</b>] {c['name']} — <b>{c['score']}</b> {labels.get(field, '')}"
            )
        lines.append(f"\n<i>Всего кланов: {len(clans)}</i>")
        await message.reply("\n".join(lines), parse_mode=ParseMode.HTML)
        return

    # ── Создать клан ──
    if sub in ("создать", "create", "новый", "new"):
        if await db.get_user_clan(uid, cid):
            await message.reply(
                f"🏰 <b>Создание клана</b>\n"
                f"{DIVIDER}\n"
                f"❌ Ты уже состоишь в клане! Сначала выйди из него.",
                parse_mode=ParseMode.HTML,
            )
            return
        if len(args) < 3:
            await message.reply(
                f"🏰 <b>Создание клана</b>\n"
                f"{DIVIDER}\n"
                f"❌ Недостаточно аргументов!\n\n"
                f"Формат: <code>клан создать [название] [ТЕГ]</code>\n"
                f"Стоимость: <b>{CLAN_CREATE_COST}</b> 🪙\n\n"
                f"<i>Тег — до 6 символов, уникальный.</i>",
                parse_mode=ParseMode.HTML,
            )
            return
        name = " ".join(args[1:-1]).strip()
        tag = _clan_tag(args[-1])
        if len(name) < 2 or len(tag) < 2:
            await message.reply(
                f"🏰 <b>Создание клана</b>\n"
                f"{DIVIDER}\n"
                f"❌ Название ≥ 2 симв., тег ≥ 2 симв. (до 6).",
                parse_mode=ParseMode.HTML,
            )
            return
        user = await db.get_user(uid, cid)
        if user["coins"] < CLAN_CREATE_COST:
            await message.reply(
                f"🏰 <b>Создание клана</b>\n"
                f"{DIVIDER}\n"
                f"❌ Недостаточно монет!\n\n"
                f"├─ Нужно: <b>{CLAN_CREATE_COST}</b> 🪙\n"
                f"└─ У тебя: <b>{user['coins']}</b> 🪙",
                parse_mode=ParseMode.HTML,
            )
            return
        await db.add_coins(uid, cid, -CLAN_CREATE_COST)
        clan_id = await db.create_clan(cid, name, tag, uid)
        if clan_id is None:
            await db.add_coins(uid, cid, CLAN_CREATE_COST)
            await message.reply(
                f"🏰 <b>Создание клана</b>\n"
                f"{DIVIDER}\n"
                f"❌ Тег <b>[{tag}]</b> уже занят! Придумай другой.",
                parse_mode=ParseMode.HTML,
            )
            return
        await message.reply(
            f"🎉 <b>Клан успешно создан!</b>\n"
            f"{DIVIDER}\n"
            f"🏷️ Тег: [<b>{tag}</b>]\n"
            f"📝 Название: <b>{name}</b>\n"
            f"👑 Лидер: {fmt_user(message.from_user)}\n"
            f"💰 Казна: 0 🪙\n\n"
            f"👉 Приглашай участников: <code>клан пригласить @user</code>",
            parse_mode=ParseMode.HTML,
        )
        return

    # ── Удалить клан ──
    if sub in ("удалить", "delete", "remove", "disband", "расформировать"):
        clan = await db.get_user_clan(uid, cid)
        if not clan:
            await message.reply("❌ Ты не состоишь ни в каком клане.")
            return
        if clan["owner_id"] != uid:
            await message.reply(
                f"💥 <b>Расформирование клана</b>\n"
                f"{DIVIDER}\n"
                f"❌ Только <b>лидер</b> может распустить клан.",
                parse_mode=ParseMode.HTML,
            )
            return
        members = await db.get_clan_members(clan["clan_id"])
        if len(members) > 1:
            await message.reply(
                f"💥 <b>Расформирование клана</b>\n"
                f"{DIVIDER}\n"
                f"❌ В клане ещё {len(members)} участников!\n\n"
                f"Сначала передай лидерство или исключи всех.",
                parse_mode=ParseMode.HTML,
            )
            return
        refund = clan["coins"]
        if refund > 0:
            await db.add_coins(uid, cid, refund)
        await db.delete_clan(clan["clan_id"])
        refund_note = f"\n💰 Возврат из казны: +{refund} 🪙" if refund > 0 else ""
        await message.reply(
            f"💥 <b>Клан распущен</b>\n"
            f"{DIVIDER}\n"
            f"Клана [<b>{clan['tag']}</b>] больше не существует.{refund_note}",
            parse_mode=ParseMode.HTML,
        )
        return

    # ── Вступить ──
    if sub in ("вступить", "join", "принять", "accept", "да", "yes"):
        # Сначала проверяем приглашение в клан
        invite = await db.get_clan_invite(uid, cid)
        if invite:
            clan = await db.get_clan_by_id(invite["clan_id"])
            if not clan:
                await db.clear_clan_invite(uid, cid)
                await message.reply("❌ Клан больше не существует.")
                return
            if await db.get_user_clan(uid, cid):
                await message.reply("❌ Ты уже в клане — выйди сначала.")
                return
            ok = await db.add_clan_member(uid, cid, clan["clan_id"])
            await db.clear_clan_invite(uid, cid)
            if ok:
                await message.reply(
                    f"✅ <b>Ты вступил в клан!</b>\n"
                    f"{DIVIDER}\n"
                    f"🏰 [<b>{clan['tag']}</b>] {clan['name']}\n\n"
                    f"🎉 Добро пожаловать! Теперь ты часть команды.",
                    parse_mode=ParseMode.HTML,
                )
            return

        # Иначе: битва?
        clan = await db.get_user_clan(uid, cid)
        if clan:
            battle = await db.get_active_battle_for_clan(clan["clan_id"], cid)
            if battle and battle["status"] == "pending" and battle["defender_clan_id"] == clan["clan_id"]:
                c2 = await db.get_clan_by_id(battle["challenger_clan_id"])
                if battle["bet"] > clan["coins"]:
                    await message.reply(
                        f"⚔️ <b>Принять битву</b>\n"
                        f"{DIVIDER}\n"
                        f"❌ В казне вашего клана недостаточно монет!\n"
                        f"├─ Нужно: <b>{battle['bet']}</b> 🪙\n"
                        f"└─ В казне: <b>{clan['coins']}</b> 🪙",
                        parse_mode=ParseMode.HTML,
                    )
                    return
                await db.accept_battle(battle["battle_id"])
                await message.reply(
                    f"⚔️ <b>БИТВА НАЧАЛАСЬ!</b>\n"
                    f"{DIVIDER}\n"
                    f"🔵 [<b>{c2['tag']}</b>] {c2['name']}\n"
                    f"           🆚\n"
                    f"🔴 [<b>{clan['tag']}</b>] {clan['name']}\n\n"
                    f"💰 Ставка: <b>{battle['bet']}</b> 🪙\n\n"
                    f"🎯 Ход 🔵: <code>клан удар [1-100]</code>",
                    parse_mode=ParseMode.HTML,
                )
                return

        if len(args) >= 2 and args[1]:
            tag = _clan_tag(args[1])
            target_clan = await db.get_clan_by_tag(cid, tag)
            if target_clan:
                await message.reply(
                    f"🚪 <b>Вступление в клан</b>\n"
                    f"{DIVIDER}\n"
                    f"❌ Вступить в [<b>{tag}</b>] по тегу нельзя!\n\n"
                    f"Нужно приглашение от офицера или лидера.",
                    parse_mode=ParseMode.HTML,
                )
                return
        await message.reply(
            f"📬 <b>Нет активных приглашений</b>\n"
            f"{DIVIDER}\n"
            f"❌ Нет ожидающих приглашений или вызовов на битву.",
            parse_mode=ParseMode.HTML,
        )
        return

    # ── Отклонить ──
    if sub in ("отклонить", "reject", "отмена", "cancel", "нет", "no"):
        invite = await db.get_clan_invite(uid, cid)
        if invite:
            await db.clear_clan_invite(uid, cid)
            clan = await db.get_clan_by_id(invite["clan_id"])
            tag = f"[{clan['tag']}]" if clan else ""
            await message.reply(
                f"🚫 <b>Приглашение отклонено</b>\n"
                f"{DIVIDER}\n"
                f"Ты не вступаешь в клан {tag}.",
                parse_mode=ParseMode.HTML,
            )
            return
        clan = await db.get_user_clan(uid, cid)
        if clan:
            battle = await db.get_active_battle_for_clan(clan["clan_id"], cid)
            if battle and battle["status"] == "pending" and battle["defender_clan_id"] == clan["clan_id"]:
                await db.reject_battle(battle["battle_id"])
                opp = await db.get_clan_by_id(battle["challenger_clan_id"])
                tag = f"[{opp['tag']}]" if opp else ""
                await message.reply(
                    f"🚫 <b>Вызов отклонён</b>\n"
                    f"{DIVIDER}\n"
                    f"Твой клан отказывается сражаться с {tag}.",
                    parse_mode=ParseMode.HTML,
                )
                return
        await message.reply(
            f"❌ <b>Нечего отклонять</b>\n"
            f"{DIVIDER}\n"
            f"Нет входящих приглашений или вызовов.",
            parse_mode=ParseMode.HTML,
        )
        return

    # ── Выйти ──
    if sub in ("выйти", "leave", "покинуть"):
        clan = await db.get_user_clan(uid, cid)
        if not clan:
            await message.reply("❌ Ты не состоишь в клане.")
            return
        if clan["owner_id"] == uid:
            await message.reply(
                f"🚪 <b>Выход из клана</b>\n"
                f"{DIVIDER}\n"
                f"❌ Лидер не может просто выйти!\n\n"
                f"Варианты:\n"
                f"├─ <code>клан лидер @user</code> — передать корону\n"
                f"└─ <code>клан удалить</code> — распустить клан",
                parse_mode=ParseMode.HTML,
            )
            return
        await db.remove_clan_member(uid, cid)
        await message.reply(
            f"🚪 <b>Ты покинул клан</b>\n"
            f"{DIVIDER}\n"
            f"Прощай, [<b>{clan['tag']}</b>] {clan['name']}!",
            parse_mode=ParseMode.HTML,
        )
        return

    # ── Пригласить ──
    if sub in ("пригласить", "invite", "зов"):
        clan = await db.get_user_clan(uid, cid)
        if not clan:
            await message.reply("❌ Сначала вступи в клан.")
            return
        role = await db.get_member_role(uid, cid)
        if role not in ("owner", "officer"):
            await message.reply(
                f"✉️ <b>Приглашение в клан</b>\n"
                f"{DIVIDER}\n"
                f"❌ Приглашать могут только 👑 Лидер и ⭐ Офицеры.",
                parse_mode=ParseMode.HTML,
            )
            return
        target = await resolve_target(message, args[1:])
        if not target:
            await message.reply(
                f"✉️ <b>Приглашение в клан</b>\n"
                f"{DIVIDER}\n"
                f"❌ Укажи пользователя!\n\n"
                f"Формат: <code>клан пригласить @user</code> (или ответом)",
                parse_mode=ParseMode.HTML,
            )
            return
        target_id, target_name = target
        if await db.get_user_clan(target_id, cid):
            await message.reply(
                f"✉️ <b>Приглашение в клан</b>\n"
                f"{DIVIDER}\n"
                f"❌ {target_name} <b>уже в клане</b>!",
                parse_mode=ParseMode.HTML,
            )
            return
        await db.add_clan_invite(cid, clan["clan_id"], uid, target_id)
        await message.reply(
            f"✉️ <b>Приглашение отправлено!</b>\n"
            f"{DIVIDER}\n"
            f"👤 Кому: {target_name}\n"
            f"🏰 Клан: [<b>{clan['tag']}</b>] {clan['name']}\n\n"
            f"👉 {target_name} должен написать: <code>клан принять</code>",
            parse_mode=ParseMode.HTML,
        )
        return

    # ── Кикнуть ──
    if sub in ("кик", "kick", "выгнать", "исключить"):
        clan = await db.get_user_clan(uid, cid)
        if not clan:
            await message.reply("❌ Ты не в клане.")
            return
        role = await db.get_member_role(uid, cid)
        if role not in ("owner", "officer"):
            await message.reply(
                f"👢 <b>Исключение из клана</b>\n"
                f"{DIVIDER}\n"
                f"❌ Исключать могут только лидер и офицеры.",
                parse_mode=ParseMode.HTML,
            )
            return
        target = await resolve_target(message, args[1:])
        if not target:
            await message.reply(
                f"👢 <b>Исключение из клана</b>\n"
                f"{DIVIDER}\n"
                f"❌ Кого кикаем?\nФормат: <code>клан кик @user</code>",
                parse_mode=ParseMode.HTML,
            )
            return
        target_id, target_name = target
        target_clan = await db.get_user_clan(target_id, cid)
        if not target_clan or target_clan["clan_id"] != clan["clan_id"]:
            await message.reply(
                f"👢 <b>Исключение из клана</b>\n"
                f"{DIVIDER}\n"
                f"❌ {target_name} не в твоём клане!",
                parse_mode=ParseMode.HTML,
            )
            return
        target_role = await db.get_member_role(target_id, cid)
        if target_role == "owner":
            await message.reply(
                f"👢 <b>Исключение из клана</b>\n"
                f"{DIVIDER}\n"
                f"❌ Лидера нельзя кикнуть — он сам король!",
                parse_mode=ParseMode.HTML,
            )
            return
        if role == "officer" and target_role == "officer":
            await message.reply(
                f"👢 <b>Исключение из клана</b>\n"
                f"{DIVIDER}\n"
                f"❌ Офицер не может кикнуть другого офицера.",
                parse_mode=ParseMode.HTML,
            )
            return
        await db.remove_clan_member(target_id, cid)
        await message.reply(
            f"👢 <b>{target_name} исключён!</b>\n"
            f"{DIVIDER}\n"
            f"Больше не участник [<b>{clan['tag']}</b>].",
            parse_mode=ParseMode.HTML,
        )
        return

    # ── Повысить ──
    if sub in ("повысить", "promote", "офицер"):
        clan = await db.get_user_clan(uid, cid)
        if not clan or clan["owner_id"] != uid:
            await message.reply(
                f"⭐ <b>Повышение</b>\n"
                f"{DIVIDER}\n"
                f"❌ Только 👑 <b>лидер</b> может назначать офицеров!",
                parse_mode=ParseMode.HTML,
            )
            return
        target = await resolve_target(message, args[1:])
        if not target:
            await message.reply(
                f"⭐ <b>Повышение до офицера</b>\n"
                f"{DIVIDER}\n"
                f"❌ Кого повышаем?\n<code>клан повысить @user</code>",
                parse_mode=ParseMode.HTML,
            )
            return
        target_id, target_name = target
        tc = await db.get_user_clan(target_id, cid)
        if not tc or tc["clan_id"] != clan["clan_id"]:
            await message.reply(
                f"⭐ <b>Повышение</b>\n"
                f"{DIVIDER}\n"
                f"❌ {target_name} не в твоём клане.",
                parse_mode=ParseMode.HTML,
            )
            return
        await db.set_member_role(target_id, cid, "officer")
        await message.reply(
            f"⭐ <b>Новый офицер!</b>\n"
            f"{DIVIDER}\n"
            f"🎉 {target_name} теперь ⭐ <b>Офицер</b> клана [<b>{clan['tag']}</b>]!",
            parse_mode=ParseMode.HTML,
        )
        return

    # ── Понизить ──
    if sub in ("понизить", "demote"):
        clan = await db.get_user_clan(uid, cid)
        if not clan or clan["owner_id"] != uid:
            await message.reply(
                f"⬇️ <b>Понижение</b>\n"
                f"{DIVIDER}\n"
                f"❌ Только 👑 лидер может понижать.",
                parse_mode=ParseMode.HTML,
            )
            return
        target = await resolve_target(message, args[1:])
        if not target:
            await message.reply(
                f"⬇️ <b>Понижение</b>\n"
                f"{DIVIDER}\n"
                f"❌ Кого понижаем?\n<code>клан понизить @user</code>",
                parse_mode=ParseMode.HTML,
            )
            return
        target_id, target_name = target
        tc = await db.get_user_clan(target_id, cid)
        if not tc or tc["clan_id"] != clan["clan_id"]:
            await message.reply(
                f"⬇️ <b>Понижение</b>\n{DIVIDER}\n"
                f"❌ {target_name} не в твоём клане.",
                parse_mode=ParseMode.HTML,
            )
            return
        if target_id == clan["owner_id"]:
            await message.reply(
                f"⬇️ <b>Понижение</b>\n{DIVIDER}\n"
                f"❌ Лидер себя понизить не может — передай корону!",
                parse_mode=ParseMode.HTML,
            )
            return
        await db.set_member_role(target_id, cid, "member")
        await message.reply(
            f"⬇️ <b>Понижение</b>\n"
            f"{DIVIDER}\n"
            f"{target_name} теперь 👤 обычный <b>участник</b>.",
            parse_mode=ParseMode.HTML,
        )
        return

    # ── Передать лидерство ──
    if sub in ("лидер", "leader", "передать", "transfer"):
        clan = await db.get_user_clan(uid, cid)
        if not clan or clan["owner_id"] != uid:
            await message.reply(
                f"👑 <b>Передача лидерства</b>\n"
                f"{DIVIDER}\n"
                f"❌ Только текущий лидер может передать корону.",
                parse_mode=ParseMode.HTML,
            )
            return
        target = await resolve_target(message, args[1:])
        if not target:
            await message.reply(
                f"👑 <b>Передача лидерства</b>\n"
                f"{DIVIDER}\n"
                f"❌ Кому передаёшь?\n<code>клан лидер @user</code>",
                parse_mode=ParseMode.HTML,
            )
            return
        target_id, target_name = target
        tc = await db.get_user_clan(target_id, cid)
        if not tc or tc["clan_id"] != clan["clan_id"]:
            await message.reply(
                f"👑 <b>Передача лидерства</b>\n"
                f"{DIVIDER}\n"
                f"❌ {target_name} не в твоём клане.",
                parse_mode=ParseMode.HTML,
            )
            return
        await db.set_member_role(uid, cid, "officer")
        await db.set_clan_owner(clan["clan_id"], target_id, cid)
        await message.reply(
            f"👑 <b>Новый ЛИДЕР!</b>\n"
            f"{DIVIDER}\n"
            f"🏰 Клан: [<b>{clan['tag']}</b>] {clan['name']}\n"
            f"🎩 Корона передана → <b>{target_name}</b>\n\n"
            f"Ты теперь ⭐ офицер.",
            parse_mode=ParseMode.HTML,
        )
        return

    # ── Депозит в казну ──
    if sub in ("депозит", "deposit", "внести", "положить", "донат"):
        clan = await db.get_user_clan(uid, cid)
        if not clan:
            await message.reply("❌ Сначала вступи в клан, чтобы пополнять казну.")
            return
        amount = parse_amount(args)
        if amount is None:
            await message.reply(
                f"🏦 <b>Пополнение казны</b>\n"
                f"{DIVIDER}\n"
                f"❌ Укажи сумму!\n\n"
                f"Формат: <code>клан депозит 100</code>\n"
                f"<i>+XP клану: сумма / 10</i>",
                parse_mode=ParseMode.HTML,
            )
            return
        user = await db.get_user(uid, cid)
        if user["coins"] < amount:
            await message.reply(
                f"🏦 <b>Пополнение казны</b>\n"
                f"{DIVIDER}\n"
                f"❌ Недостаточно монет!\n"
                f"├─ У тебя: <b>{user['coins']}</b> 🪙\n"
                f"└─ Нужно: <b>{amount}</b> 🪙",
                parse_mode=ParseMode.HTML,
            )
            return
        await db.add_coins(uid, cid, -amount)
        total = await db.add_clan_coins(clan["clan_id"], amount)
        xp_gain = amount // 10
        lvl_info = await db.add_clan_xp(clan["clan_id"], xp_gain)
        levelup_note = f"\n🎉 Клан получил новый уровень <b>{lvl_info['level']}</b>!" if lvl_info.get("level_up") else ""
        await message.reply(
            f"🏦 <b>Пополнение казны клана</b>\n"
            f"{DIVIDER}\n"
            f"� От: {fmt_user(message.from_user)}\n"
            f"🏰 Клан: [<b>{clan['tag']}</b>] {clan['name']}\n"
            f"├─ +<b>{amount}</b> 🪙 в казну\n"
            f"├─ +<b>{xp_gain}</b> XP клану\n"
            f"└─ 💰 Всего в казне: <b>{total}</b> 🪙{levelup_note}",
            parse_mode=ParseMode.HTML,
        )
        return

    # ── Вывод из казны ──
    if sub in ("вывод", "withdraw", "забрать", "снять_казна"):
        clan = await db.get_user_clan(uid, cid)
        if not clan:
            await message.reply("❌ Сначала вступи в клан.")
            return
        if clan["owner_id"] != uid:
            await message.reply(
                f"🏦 <b>Вывод из казны</b>\n"
                f"{DIVIDER}\n"
                f"❌ Только 👑 <b>лидер</b> может выводить монеты из казны!",
                parse_mode=ParseMode.HTML,
            )
            return
        amount = parse_amount(args)
        if amount is None:
            await message.reply(
                f"🏦 <b>Вывод из казны</b>\n"
                f"{DIVIDER}\n"
                f"❌ Укажи сумму!\n\n"
                f"Формат: <code>клан вывод 100</code>",
                parse_mode=ParseMode.HTML,
            )
            return
        if clan["coins"] < amount:
            await message.reply(
                f"🏦 <b>Вывод из казны</b>\n"
                f"{DIVIDER}\n"
                f"❌ В казне нет столько!\n"
                f"├─ Доступно: <b>{clan['coins']}</b> 🪙\n"
                f"└─ Запрошено: <b>{amount}</b> 🪙",
                parse_mode=ParseMode.HTML,
            )
            return
        await db.add_clan_coins(clan["clan_id"], -amount)
        new_bal = await db.add_coins(uid, cid, amount)
        await message.reply(
            f"🏦 <b>Вывод из казны</b>\n"
            f"{DIVIDER}\n"
            f"🏰 Клан: [<b>{clan['tag']}</b>]\n"
            f"👑 Лидер: {fmt_user(message.from_user)}\n"
            f"├─ Снято: <b>{amount}</b> 🪙\n"
            f"└─ 💰 Твой баланс: <b>{new_bal}</b> 🪙",
            parse_mode=ParseMode.HTML,
        )
        return

    # ── Описание ──
    if sub in ("описание", "desc", "description", "о", "инфо_клан") and len(args) > 1:
        clan = await db.get_user_clan(uid, cid)
        if not clan:
            await message.reply("❌ Ты не в клане.")
            return
        role = await db.get_member_role(uid, cid)
        if role not in ("owner", "officer"):
            await message.reply(
                f"📝 <b>Описание клана</b>\n{DIVIDER}\n"
                f"❌ Менять описание могут только лидер и офицеры.",
                parse_mode=ParseMode.HTML,
            )
            return
        desc = " ".join(args[1:])
        await db.set_clan_description(clan["clan_id"], desc)
        await message.reply(
            f"📝 <b>Описание обновлено!</b>\n"
            f"{DIVIDER}\n"
            f"🏰 [<b>{clan['tag']}</b>] {clan['name']}\n\n"
            f"Текст: <i>{desc}</i>",
            parse_mode=ParseMode.HTML,
        )
        return

    # ── Участники ──
    if sub in ("участники", "members", "состав"):
        if len(args) > 1:
            tag = _clan_tag(args[1])
            clan = await db.get_clan_by_tag(cid, tag)
        else:
            clan = await db.get_user_clan(uid, cid)
        if not clan:
            await message.reply(
                f"👥 <b>Состав клана</b>\n{DIVIDER}\n❌ Клан не найден.",
                parse_mode=ParseMode.HTML,
            )
            return
        members = await db.get_clan_members(clan["clan_id"])
        lines = [
            f"👥 <b>Состав клана — [{clan['tag']}]</b> {clan['name']}\n"
            f"{DIVIDER}\n"
            f"Всего: <b>{len(members)}</b> участников\n"
        ]
        lines.append("")
        for m in members:
            name = (m.get("username") and f"@{m['username']}") or m.get("first_name") or f"ID{m['user_id']}"
            lvl = m.get("level", 1)
            coins = m.get("coins", 0)
            role = ROLE_NAMES.get(m["role"], "👤 Участник")
            lines.append(f"{role} · {name} · ур.{lvl} · 💰 {coins}")
        await message.reply("\n".join(lines), parse_mode=ParseMode.HTML)
        return

    # ── Клановые битвы ──
    if sub in ("битва", "battle", "бой", "дуэль_клан"):
        await handle_clan_battle(message, args, uid, cid)
        return

    if sub in ("удар", "атака", "hit", "attack", "атаковать"):
        await handle_clan_attack(message, args, uid, cid)
        return

    # ── Профиль клана (по тегу или свой) ──
    clan = None
    if args:
        tag = _clan_tag(args[0])
        clan = await db.get_clan_by_tag(cid, tag)
    if not clan:
        clan = await db.get_user_clan(uid, cid)
    if not clan:
        await message.reply(
            f"� <b>Клановая система</b>\n"
            f"{DIVIDER}\n\n"
            f"Ты пока не состоишь в клане!\n\n"
            f"👉 <b>Создать свой:</b>\n"
            f"   <code>клан создать [название] [ТЕГ]</code> — {CLAN_CREATE_COST} 🪙\n\n"
            f"👉 <b>Основные команды:</b>\n"
            f"• <code>клан топ</code> — рейтинг кланов\n"
            f"• <code>клан [ТЕГ]</code> — посмотреть профиль\n"
            f"• <code>клан принять</code> — вступить по инвайту\n"
            f"• <code>клан пригласить @user</code> — позвать друзей\n\n"
            f"<i>Вступление только по приглашению от офицера.</i>",
            parse_mode=ParseMode.HTML,
        )
        return

    members = await db.get_clan_members(clan["clan_id"])
    owner = next((m for m in members if m["role"] == "owner"), None)
    owner_name = "—"
    if owner:
        owner_name = (owner.get("username") and f"@{owner['username']}") or owner.get("first_name") or f"ID{owner['user_id']}"
    lvl = clan.get("level", 1)
    xp = clan.get("xp", 0)
    needed = lvl * 200
    xp_pct = int(xp / max(1, needed) * 100)
    battle = await db.get_active_battle_for_clan(clan["clan_id"], cid)
    battle_note = ""
    if battle:
        opp_id = battle["defender_clan_id"] if battle["challenger_clan_id"] == clan["clan_id"] else battle["challenger_clan_id"]
        opp = await db.get_clan_by_id(opp_id)
        if opp:
            status = "⏳ Ожидание принятия" if battle["status"] == "pending" else "🔥 Идёт прямо сейчас"
            battle_note = (
                f"\n\n⚔️ <b>Активная битва</b>\n"
                f"├─ Статус: {status}\n"
                f"├─ Противник: [<b>{opp['tag']}</b>] {opp['name']}\n"
                f"├─ Ставка: <b>{battle['bet']}</b> 🪙\n"
                f"├─ Наше HP: ❤️ {battle['challenger_hp' if battle['challenger_clan_id']==clan['clan_id'] else 'defender_hp']}\n"
                f"└─ Ход → {'наша сторона' if (battle['turn']=='challenger' and battle['challenger_clan_id']==clan['clan_id']) or (battle['turn']=='defender' and battle['defender_clan_id']==clan['clan_id']) else 'соперника'}"
            )
    desc = clan.get("description") or ""
    desc_note = f"\n📝 <i>{desc}</i>" if desc else ""
    await message.reply(
        f"🏰 <b>[{clan['tag']}]</b> {clan['name']}\n"
        f"{DIVIDER}\n"
        f"👑 Лидер: <b>{owner_name}</b>\n"
        f"👥 Участников: <b>{len(members)}</b>\n"
        f"🎮 Уровень: <b>{lvl}</b> — <b>{xp}/{needed}</b> XP ({xp_pct}%)\n"
        f"💰 Казна: <b>{clan['coins']}</b> 🪙\n"
        f"🏆 Победы: <b>{clan.get('wins', 0)}</b> · Поражения: <b>{clan.get('losses', 0)}</b>"
        f"{desc_note}{battle_note}",
        parse_mode=ParseMode.HTML,
    )


async def handle_clan_battle(message: Message, args: list[str], uid: int, cid: int):
    clan = await db.get_user_clan(uid, cid)
    if not clan:
        await message.reply(
            f"⚔️ <b>Клановые битвы</b>\n{DIVIDER}\n"
            f"❌ Сначала вступи в клан, чтобы сражаться!",
            parse_mode=ParseMode.HTML,
        )
        return
    role = await db.get_member_role(uid, cid)
    if role not in ("owner", "officer"):
        await message.reply(
            f"⚔️ <b>Клановые битвы</b>\n{DIVIDER}\n"
            f"❌ Вызывать на битву могут только 👑 Лидер и ⭐ Офицеры.",
            parse_mode=ParseMode.HTML,
        )
        return

    # `клан битва` (без аргументов) — показать инфо о текущей битве
    if len(args) < 2:
        battle = await db.get_active_battle_for_clan(clan["clan_id"], cid)
        if not battle:
            await message.reply(
                f"⚔️ <b>Клановые битвы</b>\n"
                f"{DIVIDER}\n\n"
                f"У твоего клана нет активных битв.\n\n"
                f"👉 <b>Вызвать на бой:</b>\n"
                f"   <code>клан битва [ТЕГ] [ставка]</code>\n\n"
                f"👉 <b>Принять / отклонить:</b>\n"
                f"   <code>клан принять</code> · <code>клан отклонить</code>\n\n"
                f"👉 <b>Атаковать:</b>\n"
                f"   <code>клан удар [1-100]</code> — сила от 1 до 100%\n\n"
                f"<i>💡 Сила 70% = баланс урона и точности.</i>",
                parse_mode=ParseMode.HTML,
            )
            return
        c1 = await db.get_clan_by_id(battle["challenger_clan_id"])
        c2 = await db.get_clan_by_id(battle["defender_clan_id"])
        if not c1 or not c2:
            return
        turn_clan = c1 if battle["turn"] == "challenger" else c2
        status_text = "⏳ Ожидание принятия" if battle["status"] == "pending" else "🔥 Идёт прямо сейчас"
        await message.reply(
            f"⚔️ <b>Текущая битва</b> · {status_text}\n"
            f"{DIVIDER}\n"
            f"🔵 [<b>{c1['tag']}</b>] {c1['name']}\n"
            f"└─ ❤️ Здоровье: <b>{battle['challenger_hp']}</b> / 100\n\n"
            f"           🆚\n\n"
            f"🔴 [<b>{c2['tag']}</b>] {c2['name']}\n"
            f"└─ ❤️ Здоровье: <b>{battle['defender_hp']}</b> / 100\n"
            f"{DIVIDER}\n"
            f"💰 Ставка: <b>{battle['bet']}</b> 🪙\n"
            f"🎯 Ход сейчас: [<b>{turn_clan['tag']}</b>]",
            parse_mode=ParseMode.HTML,
        )
        return

    # Вызов на битву: клан битва [тег] [ставка]
    tag = _clan_tag(args[1])
    bet = 0
    if len(args) >= 3:
        try:
            bet = int(args[2])
        except ValueError:
            bet = 0
    if bet < 0:
        bet = 0
    defender = await db.get_clan_by_tag(cid, tag)
    if not defender:
        await message.reply(
            f"⚔️ <b>Вызов на битву</b>\n{DIVIDER}\n"
            f"❌ Клан <b>[{tag}]</b> не найден!",
            parse_mode=ParseMode.HTML,
        )
        return
    if defender["clan_id"] == clan["clan_id"]:
        await message.reply(
            f"⚔️ <b>Вызов на битву</b>\n{DIVIDER}\n"
            f"❌ Нельзя сражаться самому с собой!",
            parse_mode=ParseMode.HTML,
        )
        return
    # Нет ли у обоих кланов уже активной битвы?
    if await db.get_active_battle_for_clan(clan["clan_id"], cid):
        await message.reply(
            f"⚔️ <b>Вызов на битву</b>\n{DIVIDER}\n"
            f"❌ У твоего клана уже идёт битва! Сначала закончи её.",
            parse_mode=ParseMode.HTML,
        )
        return
    if await db.get_active_battle_for_clan(defender["clan_id"], cid):
        await message.reply(
            f"⚔️ <b>Вызов на битву</b>\n{DIVIDER}\n"
            f"❌ Противник <b>[{tag}]</b> уже сражается в другой битве!",
            parse_mode=ParseMode.HTML,
        )
        return
    if clan["coins"] < bet:
        await message.reply(
            f"⚔️ <b>Вызов на битву</b>\n{DIVIDER}\n"
            f"❌ В казне вашего клана недостаточно монет!\n"
            f"├─ Нужно: <b>{bet}</b> 🪙\n"
            f"└─ Есть: <b>{clan['coins']}</b> 🪙",
            parse_mode=ParseMode.HTML,
        )
        return
    if bet > 0 and defender["coins"] < bet:
        await message.reply(
            f"⚔️ <b>Вызов на битву</b>\n{DIVIDER}\n"
            f"❌ В казне противника <b>[{tag}]</b> нет {bet} 🪙!\n"
            f"└─ У них только <b>{defender['coins']}</b> 🪙",
            parse_mode=ParseMode.HTML,
        )
        return
    battle_id = await db.create_clan_battle(cid, clan["clan_id"], defender["clan_id"], bet)
    await message.reply(
        f"📯 <b>ВЫЗОВ НА БИТВУ!</b>\n"
        f"{DIVIDER}\n"
        f"⚔️ [<b>{clan['tag']}</b>] {clan['name']}\n"
        f"              ↓\n"
        f"🛡️ [<b>{defender['tag']}</b>] {defender['name']}\n"
        f"{DIVIDER}\n"
        f"💰 Ставка: <b>{bet}</b> 🪙\n\n"
        f"👉 [<b>{defender['tag']}</b>] — ответ:\n"
        f"├─ <code>клан принять</code> — принять бой\n"
        f"└─ <code>клан отклонить</code> — отказаться",
        parse_mode=ParseMode.HTML,
    )


async def handle_clan_attack(message: Message, args: list[str], uid: int, cid: int):
    clan = await db.get_user_clan(uid, cid)
    if not clan:
        await message.reply(
            f"💥 <b>Удар</b>\n{DIVIDER}\n"
            f"❌ Ты не в клане.",
            parse_mode=ParseMode.HTML,
        )
        return
    battle = await db.get_active_battle_for_clan(clan["clan_id"], cid)
    if not battle or battle["status"] != "active":
        await message.reply(
            f"💥 <b>Удар</b>\n{DIVIDER}\n"
            f"❌ У твоего клана сейчас нет активных битв!",
            parse_mode=ParseMode.HTML,
        )
        return

    # Чья сторона?
    my_side = "challenger" if battle["challenger_clan_id"] == clan["clan_id"] else "defender"
    if battle["turn"] != my_side:
        opp_color = "🔵" if my_side == "defender" else "🔴"
        await message.reply(
            f"💥 <b>Удар</b>\n{DIVIDER}\n"
            f"❌ Сейчас не ход твоего клана!\n\n"
            f"{opp_color} Ход противника. Ожидай.",
            parse_mode=ParseMode.HTML,
        )
        return

    # Сила атаки
    power = 50  # по умолчанию 50%
    if args:
        try:
            p = int(args[0])
            if 1 <= p <= 100:
                power = p
        except ValueError:
            pass

    members = await db.get_clan_members(clan["clan_id"])
    avg_level = sum(m.get("level", 1) for m in members) / max(1, len(members))

    base_low = 5 + int(avg_level)
    base_high = 20 + int(avg_level * 2)

    accuracy = 100 - (power // 3)  # сила 100 → точность ~67%
    if random.randint(1, 100) > accuracy:
        damage = 0
        miss_msg = "💨 <b>ПРОМАХ!</b> Противник уклонился."
    else:
        dmg = random.randint(base_low, base_high)
        damage = int(dmg * (power / 50))
        damage = max(1, damage)
        miss_msg = ""

    battle = await db.apply_battle_damage(battle["battle_id"], my_side, damage)
    opp_side = "defender" if my_side == "challenger" else "challenger"
    opp_hp = battle["defender_hp"] if my_side == "challenger" else battle["challenger_hp"]
    my_hp = battle["challenger_hp"] if my_side == "challenger" else battle["defender_hp"]
    c1 = await db.get_clan_by_id(battle["challenger_clan_id"])
    c2 = await db.get_clan_by_id(battle["defender_clan_id"])
    if not c1 or not c2:
        return

    my_color = "🔵" if my_side == "challenger" else "🔴"
    my_clan = c1 if my_side == "challenger" else c2

    # Проверка окончания битвы
    if opp_hp <= 0:
        winner_id = battle["challenger_clan_id"] if my_side == "challenger" else battle["defender_clan_id"]
        winner_clan = c1 if my_side == "challenger" else c2
        loser_clan = c2 if my_side == "challenger" else c1
        await db.finish_battle(battle["battle_id"], winner_id)
        reward_msg = ""
        if battle["bet"] > 0:
            reward_msg = (
                f"\n\n💰 <b>Ставка сыграла!</b>\n"
                f"└─ В казну [{winner_clan['tag']}] +<b>{battle['bet']}</b> 🪙"
            )
        await message.reply(
            f"🏆 <b>БИТВА ОКОНЧЕНА!</b>\n"
            f"{DIVIDER}\n"
            f"🔵 [<b>{c1['tag']}</b>] {c1['name']}\n"
            f"└─ ❤️ HP: <b>{battle['challenger_hp']}</b>\n\n"
            f"🔴 [<b>{c2['tag']}</b>] {c2['name']}\n"
            f"└─ ❤️ HP: <b>{battle['defender_hp']}</b>\n"
            f"{DIVIDER}\n"
            f"👑 ПОБЕДИТЕЛЬ: [<b>{winner_clan['tag']}</b>] <b>{winner_clan['name']}</b>!"
            f"{reward_msg}",
            parse_mode=ParseMode.HTML,
        )
        return

    turn_clan = c1 if battle["turn"] == "challenger" else c2
    atk_clan_tag = c1["tag"] if my_side == "challenger" else c2["tag"]
    atk_clan_name = c1["name"] if my_side == "challenger" else c2["name"]
    accuracy_pct = accuracy
    if damage == 0:
        dmg_text = miss_msg
    else:
        dmg_text = f"💥 <b>ПОПАДАНИЕ!</b> Урон: <b>-{damage}</b> HP"

    my_final_hp = battle["challenger_hp"] if my_side == "challenger" else battle["defender_hp"]
    opp_final_hp = battle["defender_hp"] if my_side == "challenger" else battle["challenger_hp"]
    opp_clan = c2 if my_side == "challenger" else c1

    await message.reply(
        f"⚔️ <b>Ход [{atk_clan_tag}]</b> {atk_clan_name}\n"
        f"{DIVIDER}\n"
        f"🎯 Сила атаки: <b>{power}%</b>\n"
        f"🎲 Точность: <b>{accuracy_pct}%</b>\n\n"
        f"{dmg_text}\n\n"
        f"<b>Счёт:</b>\n"
        f"{my_color} [<b>{my_clan['tag']}</b>] — ❤️ <b>{my_final_hp}</b>\n"
        f"{'🔴' if my_side=='challenger' else '🔵'} [<b>{opp_clan['tag']}</b>] — ❤️ <b>{opp_final_hp}</b>\n"
        f"{DIVIDER}\n"
        f"🎯 Ход → [<b>{turn_clan['tag']}</b>]\n"
        f"   <code>клан удар [1-100]</code>",
        parse_mode=ParseMode.HTML,
    )


async def main():
    if not BOT_TOKEN:
        raise SystemExit("BOT_TOKEN не задан в .env")

    await db.init_db()
    bot = Bot(token=BOT_TOKEN)
    dp = Dispatcher()
    dp.include_router(router)

    me = await bot.get_me()
    log.info("Starting %s (@%s)...", BOT_NAME, me.username)

    # Sea Battle realtime API (same process)
    try:
        from seabattle.server import start_game_api
        await start_game_api()
        if GAME_API_URL:
            log.info("Sea Battle public API: %s", GAME_API_URL)
        else:
            log.warning(
                "GAME_API_URL не задан — мини-апп не достучится до API с GitHub Pages. "
                "Укажи публичный URL (ngrok/VPS) в .env"
            )
    except Exception:
        log.exception("Не удалось запустить Sea Battle API")

    await bot.set_my_commands([
        {"command": "start", "description": "🌟 Запуск бота"},
        {"command": "help", "description": "📋 Список команд"},
        {"command": "activate", "description": "✅ Активировать в группе"},
    ])
    await bot.set_chat_menu_button(
        menu_button=MenuButtonWebApp(
            text="Mini App",
            web_app=WebAppInfo(url=sanitize_mini_app_url(MINI_APP_URL)),
        )
    )
    await bot.set_my_description(
        f"💎 {BOT_NAME} × РЕРЕ — модерация, экономика, игры.\n"
        f"🔑 Брелок РЕРЕ: +{int(FOUNDER_PROFIT_BONUS * 100)}% к прибыли"
    )
    await bot.set_my_short_description(
        f"💎 {BOT_NAME} · 🔑 РЕРЕ +{int(FOUNDER_PROFIT_BONUS * 100)}% · 🛡 💰 🎮"
    )

    await dp.start_polling(bot, allowed_updates=dp.resolve_used_update_types())


if __name__ == "__main__":
    asyncio.run(main())
