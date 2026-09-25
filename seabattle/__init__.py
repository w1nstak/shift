"""Shift Sea Battle — online multiplayer."""
from seabattle.engine import engine
from seabattle.server import create_app, start_game_api

__all__ = ["engine", "create_app", "start_game_api"]
