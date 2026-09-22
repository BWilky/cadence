"""Tiny SQLite document store.

Everything Cadence persists is a JSON document keyed by (kind, id). Pydantic models give
the documents their shape; this module just gets them on and off disk safely.
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
import time
from pathlib import Path
from typing import Any


class Store:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = asyncio.Lock()
        self._conn = sqlite3.connect(str(path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute(
            """CREATE TABLE IF NOT EXISTS docs (
                 kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL,
                 updated_at REAL NOT NULL, PRIMARY KEY (kind, id))"""
        )
        self._conn.execute(
            """CREATE TABLE IF NOT EXISTS log (
                 seq INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, level TEXT NOT NULL,
                 kind TEXT NOT NULL, message TEXT NOT NULL, detail TEXT)"""
        )
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()

    # ---------------------------------------------------------------- documents
    def get(self, kind: str, id_: str) -> dict | None:
        row = self._conn.execute("SELECT body FROM docs WHERE kind=? AND id=?", (kind, id_)).fetchone()
        return json.loads(row["body"]) if row else None

    def list(self, kind: str) -> list[dict]:
        rows = self._conn.execute("SELECT body FROM docs WHERE kind=? ORDER BY id", (kind,)).fetchall()
        return [json.loads(r["body"]) for r in rows]

    def list_range(self, kind: str, lo: str, hi: str) -> list[dict]:
        rows = self._conn.execute("SELECT body FROM docs WHERE kind=? AND id>=? AND id<=? ORDER BY id", (kind, lo, hi)).fetchall()
        return [json.loads(r["body"]) for r in rows]

    def put(self, kind: str, id_: str, body: dict) -> None:
        self._conn.execute(
            "INSERT INTO docs(kind,id,body,updated_at) VALUES(?,?,?,?) "
            "ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body, updated_at=excluded.updated_at",
            (kind, id_, json.dumps(body), time.time()),
        )
        self._conn.commit()

    def delete(self, kind: str, id_: str) -> bool:
        cur = self._conn.execute("DELETE FROM docs WHERE kind=? AND id=?", (kind, id_))
        self._conn.commit()
        return cur.rowcount > 0

    # ---------------------------------------------------------------- log
    def log(self, level: str, kind: str, message: str, detail: Any = None) -> dict:
        ts = time.time()
        det = json.dumps(detail) if detail is not None else None
        cur = self._conn.execute("INSERT INTO log(ts,level,kind,message,detail) VALUES(?,?,?,?,?)", (ts, level, kind, message, det))
        self._conn.commit()
        # Keep the log bounded.
        self._conn.execute("DELETE FROM log WHERE seq < (SELECT MAX(seq) FROM log) - 5000")
        return {"seq": cur.lastrowid, "ts": ts, "level": level, "kind": kind, "message": message, "detail": detail}

    def recent_log(self, limit: int = 200, before: int | None = None) -> list[dict]:
        if before:
            rows = self._conn.execute("SELECT * FROM log WHERE seq<? ORDER BY seq DESC LIMIT ?", (before, limit)).fetchall()
        else:
            rows = self._conn.execute("SELECT * FROM log ORDER BY seq DESC LIMIT ?", (limit,)).fetchall()
        out = []
        for r in rows:
            out.append(
                {
                    "seq": r["seq"],
                    "ts": r["ts"],
                    "level": r["level"],
                    "kind": r["kind"],
                    "message": r["message"],
                    "detail": json.loads(r["detail"]) if r["detail"] else None,
                }
            )
        return out
