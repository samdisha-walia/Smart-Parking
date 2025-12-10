"""SQLite persistence helpers for storing inference telemetry."""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from typing import Iterable, List, Dict, Optional, Tuple

DB_PATH = Path(__file__).resolve().parent / "telemetry.db"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS detections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    lot_id TEXT NOT NULL,
    label TEXT NOT NULL,
    confidence REAL NOT NULL,
    bbox TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS hourly_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hour_start TEXT NOT NULL,
    lot_id TEXT NOT NULL,
    total_detections INTEGER NOT NULL,
    summary TEXT NOT NULL,
    UNIQUE(lot_id, hour_start)
);
CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slot_id TEXT NOT NULL,
    lot_id TEXT NOT NULL,
    user_ref TEXT NOT NULL,
    status TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    payment_ref TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS anpr_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plate TEXT NOT NULL,
    confidence REAL NOT NULL,
    lot_id TEXT NOT NULL,
    direction TEXT NOT NULL,
    frame_url TEXT,
    captured_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reservation_id INTEGER,
    amount REAL NOT NULL,
    currency TEXT NOT NULL,
    status TEXT NOT NULL,
    provider_order_id TEXT,
    provider_ref TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (reservation_id) REFERENCES reservations(id)
);
CREATE TABLE IF NOT EXISTS passes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    reservation_id INTEGER NOT NULL,
    slot_id TEXT NOT NULL,
    lot_id TEXT NOT NULL,
    vehicle_plate TEXT,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    amount REAL NOT NULL,
    status TEXT NOT NULL,
    payment_ref TEXT,
    generated_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS parking_zones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    zone_code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    level TEXT,
    description TEXT,
    total_slots INTEGER NOT NULL DEFAULT 0,
    ev_slots INTEGER NOT NULL DEFAULT 0,
    vip_slots INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS parking_slots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    zone_id INTEGER NOT NULL,
    slot_id TEXT UNIQUE NOT NULL,
    slot_type TEXT NOT NULL DEFAULT 'normal',
    status TEXT NOT NULL DEFAULT 'available',
    price_per_hour REAL NOT NULL DEFAULT 50,
    metadata TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (zone_id) REFERENCES parking_zones(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS camera_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    zone_id INTEGER,
    name TEXT NOT NULL,
    stream_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'offline',
    last_heartbeat TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (zone_id) REFERENCES parking_zones(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS pricing_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    applies_to TEXT NOT NULL DEFAULT 'global',
    base_rate REAL NOT NULL,
    multiplier REAL NOT NULL DEFAULT 1.0,
    schedule TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS system_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    metric TEXT NOT NULL,
    status TEXT NOT NULL,
    value REAL,
    details TEXT,
    recorded_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT NOT NULL,
    booking_enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    reset_token TEXT,
    reset_token_expires TEXT,
    refresh_token TEXT,
    refresh_token_expires TEXT
);
CREATE TABLE IF NOT EXISTS vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    license_plate TEXT NOT NULL,
    make TEXT,
    model TEXT,
    color TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    reservation_id INTEGER,
    rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
    comment TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE SET NULL
);
"""


def _get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL;")
    return conn


def get_connection() -> sqlite3.Connection:
    """Public accessor for raw SQLite connection."""
    return _get_connection()


def init_db() -> None:
    with _get_connection() as conn:
        conn.executescript(_SCHEMA)


def _ensure_user_columns() -> None:
    with _get_connection() as conn:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
        if "refresh_token" not in columns:
            conn.execute("ALTER TABLE users ADD COLUMN refresh_token TEXT")
        if "refresh_token_expires" not in columns:
            conn.execute("ALTER TABLE users ADD COLUMN refresh_token_expires TEXT")
        if "booking_enabled" not in columns:
            conn.execute("ALTER TABLE users ADD COLUMN booking_enabled INTEGER NOT NULL DEFAULT 1")


def _ensure_payment_columns() -> None:
    with _get_connection() as conn:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(payments)").fetchall()}
        if "provider_order_id" not in columns:
            conn.execute("ALTER TABLE payments ADD COLUMN provider_order_id TEXT")


def _ensure_pass_columns() -> None:
    with _get_connection() as conn:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(passes)").fetchall()}
        required = {
            "user_id",
            "reservation_id",
            "slot_id",
            "lot_id",
            "vehicle_plate",
            "start_time",
            "end_time",
            "amount",
            "status",
            "payment_ref",
            "generated_at",
            "created_at",
        }
        missing = required - columns
        if missing:
            conn.execute("DROP TABLE IF EXISTS passes")
            conn.executescript(
                """
                CREATE TABLE passes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    reservation_id INTEGER NOT NULL,
                    slot_id TEXT NOT NULL,
                    lot_id TEXT NOT NULL,
                    vehicle_plate TEXT,
                    start_time TEXT NOT NULL,
                    end_time TEXT NOT NULL,
                    amount REAL NOT NULL,
                    status TEXT NOT NULL,
                    payment_ref TEXT,
                    generated_at TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE
                );
                """
            )


# Initialize on module import
init_db()
_ensure_user_columns()
_ensure_payment_columns()
_ensure_pass_columns()


def _timestamp() -> str:
    return datetime.utcnow().isoformat(timespec="seconds")


def record_detections(lot_id: str, detections: Iterable[dict]) -> None:
    payload = [
        (
            datetime.utcnow().isoformat(timespec="seconds"),
            lot_id,
            det["label"],
            det["confidence"],
            json.dumps(det["bbox"]),
        )
        for det in detections
    ]
    if not payload:
        return
    with _get_connection() as conn:
        conn.executemany(
            "INSERT INTO detections (created_at, lot_id, label, confidence, bbox) VALUES (?, ?, ?, ?, ?)",
            payload,
        )


def record_hourly_stat(lot_id: str, hour_start: str, total: int, summary: dict) -> None:
    encoded_summary = json.dumps(summary)
    with _get_connection() as conn:
        conn.execute(
            """
            INSERT INTO hourly_stats (hour_start, lot_id, total_detections, summary)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(lot_id, hour_start)
            DO UPDATE SET total_detections=excluded.total_detections,
                          summary=excluded.summary
            """,
            (hour_start, lot_id, total, encoded_summary),
        )


# Initialize on module import
init_db()


def fetch_recent_detections(lot_id: str, limit: int = 50) -> List[Dict]:
    with _get_connection() as conn:
        rows = conn.execute(
            """
            SELECT created_at, lot_id, label, confidence, bbox
            FROM detections
            WHERE lot_id = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (lot_id, limit),
        ).fetchall()
    detections = []
    for created_at, lot, label, confidence, bbox_json in rows:
        detections.append(
            {
                "created_at": created_at,
                "lot_id": lot,
                "label": label,
                "confidence": confidence,
                "bbox": json.loads(bbox_json),
            }
        )
    return detections


def fetch_snapshot_counts(lot_id: str, window_minutes: int = 15) -> Dict[str, int]:
    cutoff = datetime.utcnow() - timedelta(minutes=window_minutes)
    with _get_connection() as conn:
        rows = conn.execute(
            """
            SELECT label, COUNT(*) 
            FROM detections
            WHERE lot_id = ? AND created_at >= ?
            GROUP BY label
            """,
            (lot_id, cutoff.isoformat(timespec="seconds")),
        ).fetchall()
    return {label: count for label, count in rows}


def create_reservation(
    slot_id: str,
    lot_id: str,
    user_ref: str,
    start_time: str,
    end_time: str,
) -> Dict:
    created_at = datetime.utcnow().isoformat(timespec="seconds")
    with _get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO reservations (slot_id, lot_id, user_ref, status, start_time, end_time, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (slot_id, lot_id, user_ref, "pending", start_time, end_time, created_at),
        )
        reservation_id = cursor.lastrowid
    return fetch_reservation(reservation_id)


def update_reservation_status(
    reservation_id: int, status: str, payment_ref: Optional[str] = None
) -> Dict:
    with _get_connection() as conn:
        conn.execute(
            """
            UPDATE reservations
            SET status = ?, payment_ref = COALESCE(?, payment_ref)
            WHERE id = ?
            """,
            (status, payment_ref, reservation_id),
        )
    return fetch_reservation(reservation_id)


def fetch_reservation(reservation_id: int) -> Dict:
    with _get_connection() as conn:
        row = conn.execute(
            """
            SELECT id, slot_id, lot_id, user_ref, status, start_time, end_time, payment_ref, created_at
            FROM reservations
            WHERE id = ?
            """,
            (reservation_id,),
        ).fetchone()
    if not row:
        raise ValueError(f"Reservation {reservation_id} not found")
    keys = [
        "id",
        "slot_id",
        "lot_id",
        "user_ref",
        "status",
        "start_time",
        "end_time",
        "payment_ref",
        "created_at",
    ]
    return dict(zip(keys, row))


def list_reservations(status: Optional[str] = None, limit: int = 100) -> List[Dict]:
    clauses = []
    params: List = []
    if status:
        clauses.append("status = ?")
        params.append(status)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    query = f"""
        SELECT id, slot_id, lot_id, user_ref, status, start_time, end_time, payment_ref, created_at
        FROM reservations
        {where}
        ORDER BY created_at DESC
        LIMIT ?
    """
    params.append(limit)
    with _get_connection() as conn:
        rows = conn.execute(query, params).fetchall()
    keys = [
        "id",
        "slot_id",
        "lot_id",
        "user_ref",
        "status",
        "start_time",
        "end_time",
        "payment_ref",
        "created_at",
    ]
    return [dict(zip(keys, row)) for row in rows]


# --- Parking zones & slots -------------------------------------------------

def create_parking_zone(
    zone_code: str,
    name: str,
    level: Optional[str] = None,
    description: Optional[str] = None,
    total_slots: int = 0,
    ev_slots: int = 0,
    vip_slots: int = 0,
) -> Dict:
    now = _timestamp()
    with _get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO parking_zones (
                zone_code, name, level, description, total_slots,
                ev_slots, vip_slots, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                zone_code,
                name,
                level,
                description,
                total_slots,
                ev_slots,
                vip_slots,
                now,
                now,
            ),
        )
        zone_id = cursor.lastrowid
    return fetch_parking_zone(zone_id)


def update_parking_zone(
    zone_id: int,
    **fields,
) -> Dict:
    if not fields:
        return fetch_parking_zone(zone_id)
    assignments = []
    params: List = []
    for key, value in fields.items():
        assignments.append(f"{key} = ?")
        params.append(value)
    assignments.append("updated_at = ?")
    params.append(_timestamp())
    params.append(zone_id)
    with _get_connection() as conn:
        conn.execute(
            f"""
            UPDATE parking_zones
            SET {', '.join(assignments)}
            WHERE id = ?
            """,
            params,
        )
    return fetch_parking_zone(zone_id)


def fetch_parking_zone(zone_id: int) -> Dict:
    with _get_connection() as conn:
        row = conn.execute(
            """
            SELECT id, zone_code, name, level, description,
                   total_slots, ev_slots, vip_slots, created_at, updated_at
            FROM parking_zones
            WHERE id = ?
            """,
            (zone_id,),
        ).fetchone()
    if not row:
        raise ValueError(f"Parking zone {zone_id} not found")
    keys = [
        "id",
        "zone_code",
        "name",
        "level",
        "description",
        "total_slots",
        "ev_slots",
        "vip_slots",
        "created_at",
        "updated_at",
    ]
    return dict(zip(keys, row))


def list_parking_zones(include_slots: bool = False) -> List[Dict]:
    with _get_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, zone_code, name, level, description,
                   total_slots, ev_slots, vip_slots, created_at, updated_at
            FROM parking_zones
            ORDER BY zone_code ASC
            """
        ).fetchall()
        zones = [
            dict(
                zip(
                    [
                        "id",
                        "zone_code",
                        "name",
                        "level",
                        "description",
                        "total_slots",
                        "ev_slots",
                        "vip_slots",
                        "created_at",
                        "updated_at",
                    ],
                    row,
                )
            )
            for row in rows
        ]
        if include_slots:
            slot_rows = conn.execute(
                """
                SELECT id, zone_id, slot_id, slot_type, status,
                       price_per_hour, metadata, updated_at
                FROM parking_slots
                ORDER BY slot_id ASC
                """
            ).fetchall()
            slots = {}
            for (
                slot_id,
                zone_id,
                slot_code,
                slot_type,
                status,
                price_per_hour,
                metadata,
                updated_at,
            ) in slot_rows:
                slots.setdefault(zone_id, []).append(
                    {
                        "id": slot_id,
                        "slot_id": slot_code,
                        "slot_type": slot_type,
                        "status": status,
                        "price_per_hour": price_per_hour,
                        "metadata": json.loads(metadata) if metadata else None,
                        "updated_at": updated_at,
                    }
                )
            for zone in zones:
                zone["slots"] = slots.get(zone["id"], [])
        return zones


def create_parking_slot(
    zone_id: int,
    slot_code: str,
    slot_type: str = "normal",
    price_per_hour: float = 50.0,
    metadata: Optional[Dict] = None,
) -> Dict:
    updated_at = _timestamp()
    with _get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO parking_slots (
                zone_id, slot_id, slot_type, status, price_per_hour, metadata, updated_at
            )
            VALUES (?, ?, ?, 'available', ?, ?, ?)
            """,
            (
                zone_id,
                slot_code,
                slot_type,
                price_per_hour,
                json.dumps(metadata) if metadata else None,
                updated_at,
            ),
        )
        slot_id = cursor.lastrowid
    return fetch_parking_slot(slot_id)


def update_parking_slot(
    slot_id: int,
    **fields,
) -> Dict:
    if not fields:
        return fetch_parking_slot(slot_id)
    assignments = []
    params: List = []
    for key, value in fields.items():
        if key == "metadata" and isinstance(value, dict):
            value = json.dumps(value)
        assignments.append(f"{key} = ?")
        params.append(value)
    assignments.append("updated_at = ?")
    params.append(_timestamp())
    params.append(slot_id)
    with _get_connection() as conn:
        conn.execute(
            f"""
            UPDATE parking_slots
            SET {', '.join(assignments)}
            WHERE id = ?
            """,
            params,
        )
    return fetch_parking_slot(slot_id)


def fetch_parking_slot(slot_id: int) -> Dict:
    with _get_connection() as conn:
        row = conn.execute(
            """
            SELECT id, zone_id, slot_id, slot_type, status, price_per_hour, metadata, updated_at
            FROM parking_slots
            WHERE id = ?
            """,
            (slot_id,),
        ).fetchone()
    if not row:
        raise ValueError(f"Parking slot {slot_id} not found")
    keys = [
        "id",
        "zone_id",
        "slot_id",
        "slot_type",
        "status",
        "price_per_hour",
        "metadata",
        "updated_at",
    ]
    payload = dict(zip(keys, row))
    payload["metadata"] = json.loads(payload["metadata"]) if payload["metadata"] else None
    return payload


def list_parking_slots(zone_id: Optional[int] = None, status: Optional[str] = None) -> List[Dict]:
    clauses = []
    params: List = []
    if zone_id is not None:
        clauses.append("zone_id = ?")
        params.append(zone_id)
    if status is not None:
        clauses.append("status = ?")
        params.append(status)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    query = f"""
        SELECT id, zone_id, slot_id, slot_type, status, price_per_hour, metadata, updated_at
        FROM parking_slots
        {where}
        ORDER BY slot_id ASC
    """
    with _get_connection() as conn:
        rows = conn.execute(query, params).fetchall()
    results = []
    for row in rows:
        payload = dict(
            zip(
                [
                    "id",
                    "zone_id",
                    "slot_id",
                    "slot_type",
                    "status",
                    "price_per_hour",
                    "metadata",
                    "updated_at",
                ],
                row,
            )
        )
        payload["metadata"] = json.loads(payload["metadata"]) if payload["metadata"] else None
        results.append(payload)
    return results


# --- Camera sources --------------------------------------------------------

def register_camera_source(
    name: str,
    stream_url: str,
    zone_id: Optional[int] = None,
) -> Dict:
    created_at = _timestamp()
    with _get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO camera_sources (zone_id, name, stream_url, status, last_heartbeat, created_at)
            VALUES (?, ?, ?, 'offline', NULL, ?)
            """,
            (zone_id, name, stream_url, created_at),
        )
        camera_id = cursor.lastrowid
    return fetch_camera_source(camera_id)


def update_camera_source(camera_id: int, **fields) -> Dict:
    if not fields:
        return fetch_camera_source(camera_id)
    assignments = []
    params: List = []
    for key, value in fields.items():
        assignments.append(f"{key} = ?")
        params.append(value)
    params.append(camera_id)
    with _get_connection() as conn:
        conn.execute(
            f"""
            UPDATE camera_sources
            SET {', '.join(assignments)}
            WHERE id = ?
            """,
            params,
        )
    return fetch_camera_source(camera_id)


def record_camera_heartbeat(camera_id: int, status: Optional[str] = None) -> Dict:
    fields = {"last_heartbeat": _timestamp()}
    if status:
        fields["status"] = status
    return update_camera_source(camera_id, **fields)


def fetch_camera_source(camera_id: int) -> Dict:
    with _get_connection() as conn:
        row = conn.execute(
            """
            SELECT id, zone_id, name, stream_url, status, last_heartbeat, created_at
            FROM camera_sources
            WHERE id = ?
            """,
            (camera_id,),
        ).fetchone()
    if not row:
        raise ValueError(f"Camera {camera_id} not found")
    keys = ["id", "zone_id", "name", "stream_url", "status", "last_heartbeat", "created_at"]
    return dict(zip(keys, row))


def list_camera_sources(zone_id: Optional[int] = None) -> List[Dict]:
    where = ""
    params: List = []
    if zone_id is not None:
        where = "WHERE zone_id = ?"
        params.append(zone_id)
    with _get_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT id, zone_id, name, stream_url, status, last_heartbeat, created_at
            FROM camera_sources
            {where}
            ORDER BY created_at DESC
            """,
            params,
        ).fetchall()
    keys = ["id", "zone_id", "name", "stream_url", "status", "last_heartbeat", "created_at"]
    return [dict(zip(keys, row)) for row in rows]


# --- Pricing rules ---------------------------------------------------------

def upsert_pricing_rule(
    name: str,
    base_rate: float,
    multiplier: float = 1.0,
    applies_to: str = "global",
    schedule: Optional[str] = None,
    active: bool = True,
    rule_id: Optional[int] = None,
) -> Dict:
    now = _timestamp()
    with _get_connection() as conn:
        if rule_id:
            conn.execute(
                """
                UPDATE pricing_rules
                SET name = ?, base_rate = ?, multiplier = ?, applies_to = ?,
                    schedule = ?, active = ?, updated_at = ?
                WHERE id = ?
                """,
                (name, base_rate, multiplier, applies_to, schedule, int(active), now, rule_id),
            )
            target_id = rule_id
        else:
            cursor = conn.execute(
                """
                INSERT INTO pricing_rules (
                    name, base_rate, multiplier, applies_to, schedule, active, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (name, base_rate, multiplier, applies_to, schedule, int(active), now, now),
            )
            target_id = cursor.lastrowid
    return fetch_pricing_rule(target_id)


def fetch_pricing_rule(rule_id: int) -> Dict:
    with _get_connection() as conn:
        row = conn.execute(
            """
            SELECT id, name, applies_to, base_rate, multiplier, schedule, active, created_at, updated_at
            FROM pricing_rules
            WHERE id = ?
            """,
            (rule_id,),
        ).fetchone()
    if not row:
        raise ValueError(f"Pricing rule {rule_id} not found")
    keys = [
        "id",
        "name",
        "applies_to",
        "base_rate",
        "multiplier",
        "schedule",
        "active",
        "created_at",
        "updated_at",
    ]
    payload = dict(zip(keys, row))
    payload["active"] = bool(payload["active"])
    return payload


def list_pricing_rules(active_only: bool = False) -> List[Dict]:
    where = "WHERE active = 1" if active_only else ""
    with _get_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT id, name, applies_to, base_rate, multiplier, schedule, active, created_at, updated_at
            FROM pricing_rules
            {where}
            ORDER BY created_at DESC
            """
        ).fetchall()
    keys = [
        "id",
        "name",
        "applies_to",
        "base_rate",
        "multiplier",
        "schedule",
        "active",
        "created_at",
        "updated_at",
    ]
    results = [dict(zip(keys, row)) for row in rows]
    for result in results:
        result["active"] = bool(result["active"])
    return results


# --- System metrics & analytics -------------------------------------------

def record_system_metric(
    metric: str,
    status: str,
    value: Optional[float] = None,
    details: Optional[Dict] = None,
) -> Dict:
    recorded_at = _timestamp()
    with _get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO system_metrics (metric, status, value, details, recorded_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (metric, status, value, json.dumps(details) if details else None, recorded_at),
        )
        metric_id = cursor.lastrowid
    return fetch_system_metric(metric_id)


def fetch_system_metric(metric_id: int) -> Dict:
    with _get_connection() as conn:
        row = conn.execute(
            """
            SELECT id, metric, status, value, details, recorded_at
            FROM system_metrics
            WHERE id = ?
            """,
            (metric_id,),
        ).fetchone()
    if not row:
        raise ValueError(f"System metric {metric_id} not found")
    payload = dict(zip(["id", "metric", "status", "value", "details", "recorded_at"], row))
    payload["details"] = json.loads(payload["details"]) if payload["details"] else None
    return payload


def list_system_metrics(metric: Optional[str] = None, limit: int = 100) -> List[Dict]:
    where = ""
    params: List = []
    if metric:
        where = "WHERE metric = ?"
        params.append(metric)
    params.append(limit)
    with _get_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT id, metric, status, value, details, recorded_at
            FROM system_metrics
            {where}
            ORDER BY recorded_at DESC
            LIMIT ?
            """,
            params,
        ).fetchall()
    results = []
    for row in rows:
        payload = dict(zip(["id", "metric", "status", "value", "details", "recorded_at"], row))
        payload["details"] = json.loads(payload["details"]) if payload["details"] else None
        results.append(payload)
    return results


def revenue_summary(group_by: str = "day", limit: int = 30) -> List[Dict]:
    """
    Aggregate succeeded payments by day/week/month.
    """
    if group_by not in {"day", "week", "month"}:
        raise ValueError("group_by must be day, week, or month")
    format_map = {
        "day": "%Y-%m-%d",
        "week": "%Y-W%W",
        "month": "%Y-%m",
    }
    fmt = format_map[group_by]
    with _get_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT strftime('{fmt}', created_at) as bucket,
                   SUM(amount) as revenue,
                   COUNT(*) as transactions
            FROM payments
            WHERE status = 'succeeded'
            GROUP BY bucket
            ORDER BY bucket DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [
        {"bucket": bucket, "revenue": revenue or 0.0, "transactions": transactions}
        for bucket, revenue, transactions in rows
    ]


def transaction_log(limit: int = 100) -> List[Dict]:
    with _get_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, reservation_id, amount, currency, status, provider_ref, created_at, updated_at
            FROM payments
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    keys = [
        "id",
        "reservation_id",
        "amount",
        "currency",
        "status",
        "provider_ref",
        "created_at",
        "updated_at",
    ]
    return [dict(zip(keys, row)) for row in rows]


def occupancy_trends(lot_id: str, hours: int = 24) -> List[Dict]:
    cutoff = datetime.utcnow() - timedelta(hours=hours)
    with _get_connection() as conn:
        rows = conn.execute(
            """
            SELECT hour_start, total_detections, summary
            FROM hourly_stats
            WHERE lot_id = ? AND hour_start >= ?
            ORDER BY hour_start ASC
            """,
            (lot_id, cutoff.isoformat(timespec="seconds")),
        ).fetchall()
    trends = []
    for hour_start, total, summary_json in rows:
        trends.append(
            {
                "hour_start": hour_start,
                "total_detections": total,
                "summary": json.loads(summary_json),
            }
        )
    return trends


def active_reservations_by_zone() -> List[Dict]:
    with _get_connection() as conn:
        rows = conn.execute(
            """
            SELECT lot_id, status, COUNT(*) as count
            FROM reservations
            WHERE status IN ('pending', 'confirmed')
            GROUP BY lot_id, status
            """
        ).fetchall()
    return [{"lot_id": lot_id, "status": status, "count": count} for lot_id, status, count in rows]


def _user_row_to_dict(row: sqlite3.Row) -> Dict:
    keys = [
        "id",
        "name",
        "email",
        "password_hash",
        "salt",
        "role",
        "booking_enabled",
        "created_at",
        "reset_token",
        "reset_token_expires",
        "refresh_token",
        "refresh_token_expires",
    ]
    return dict(zip(keys, row))


def fetch_user_by_email(email: str) -> Optional[Dict]:
    with _get_connection() as conn:
        row = conn.execute(
            """
            SELECT id, name, email, password_hash, salt, role, booking_enabled, created_at, reset_token, reset_token_expires, refresh_token, refresh_token_expires
            FROM users
            WHERE email = ?
            """,
            (email,),
        ).fetchone()
    return _user_row_to_dict(row) if row else None


def fetch_user(user_id: int) -> Optional[Dict]:
    with _get_connection() as conn:
        row = conn.execute(
            """
            SELECT id, name, email, password_hash, salt, role, booking_enabled, created_at, reset_token, reset_token_expires, refresh_token, refresh_token_expires
            FROM users
            WHERE id = ?
            """,
            (user_id,),
        ).fetchone()
    return _user_row_to_dict(row) if row else None


def create_user(name: str, email: str, password_hash: str, salt: str, role: str) -> Dict:
    created_at = datetime.utcnow().isoformat(timespec="seconds")
    with _get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO users (name, email, password_hash, salt, role, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (name, email, password_hash, salt, role, created_at),
        )
        user_id = cursor.lastrowid
    return fetch_user(user_id)


def list_users(role: Optional[str] = None, limit: int = 200) -> List[Dict]:
    clauses = []
    params: List = []
    if role:
        clauses.append("role = ?")
        params.append(role)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    query = f"""
        SELECT id, name, email, role, booking_enabled, created_at
        FROM users
        {where}
        ORDER BY created_at DESC
        LIMIT ?
    """
    params.append(limit)
    with _get_connection() as conn:
        rows = conn.execute(query, params).fetchall()
    keys = ["id", "name", "email", "role", "booking_enabled", "created_at"]
    return [dict(zip(keys, row)) for row in rows]


def set_booking_enabled(user_id: int, enabled: bool) -> Dict:
    with _get_connection() as conn:
        cur = conn.execute(
            """
            UPDATE users
            SET booking_enabled = ?
            WHERE id = ?
            """,
            (1 if enabled else 0, user_id),
        )
        if cur.rowcount == 0:
            raise ValueError(f"User {user_id} not found")
    return fetch_user(user_id)


def set_user_role(user_id: int, role: str) -> Dict:
    if role not in {"user", "admin"}:
        raise ValueError("Invalid role")
    with _get_connection() as conn:
        cur = conn.execute(
            """
            UPDATE users
            SET role = ?
            WHERE id = ?
            """,
            (role, user_id),
        )
        if cur.rowcount == 0:
            raise ValueError(f"User {user_id} not found")
    return fetch_user(user_id)


def update_user_password(user_id: int, password_hash: str, salt: str) -> Dict:
    with _get_connection() as conn:
        conn.execute(
            """
            UPDATE users
            SET password_hash = ?, salt = ?, reset_token = NULL, reset_token_expires = NULL,
                refresh_token = NULL, refresh_token_expires = NULL
            WHERE id = ?
            """,
            (password_hash, salt, user_id),
        )
    return fetch_user(user_id)


def store_reset_token(user_id: int, token: str, expires_at: str) -> None:
    with _get_connection() as conn:
        conn.execute(
            """
            UPDATE users
            SET reset_token = ?, reset_token_expires = ?
            WHERE id = ?
            """,
            (token, expires_at, user_id),
        )


def fetch_user_by_reset_token(token: str) -> Optional[Dict]:
    with _get_connection() as conn:
        row = conn.execute(
            """
            SELECT id, name, email, password_hash, salt, role, booking_enabled, created_at, reset_token, reset_token_expires, refresh_token, refresh_token_expires
            FROM users
            WHERE reset_token = ?
            """,
            (token,),
        ).fetchone()
    return _user_row_to_dict(row) if row else None


def store_refresh_token(user_id: int, token_hash: Optional[str], expires_at: Optional[str]) -> None:
    with _get_connection() as conn:
        conn.execute(
            """
            UPDATE users
            SET refresh_token = ?, refresh_token_expires = ?
            WHERE id = ?
            """,
            (token_hash, expires_at, user_id),
        )


def fetch_user_by_refresh_token(token_hash: str) -> Optional[Dict]:
    with _get_connection() as conn:
        row = conn.execute(
            """
            SELECT id, name, email, password_hash, salt, role, booking_enabled, created_at, reset_token, reset_token_expires, refresh_token, refresh_token_expires
            FROM users
            WHERE refresh_token = ?
            """,
            (token_hash,),
        ).fetchone()
    return _user_row_to_dict(row) if row else None


def list_payments(status: Optional[str] = None, limit: int = 100) -> List[Dict]:
    clauses = []
    params: List = []
    if status:
        clauses.append("status = ?")
        params.append(status)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    query = f"""
        SELECT id, reservation_id, amount, currency, status, provider_ref, created_at, updated_at
        FROM payments
        {where}
        ORDER BY created_at DESC
        LIMIT ?
    """
    params.append(limit)
    with _get_connection() as conn:
        rows = conn.execute(query, params).fetchall()
    keys = [
        "id",
        "reservation_id",
        "amount",
        "currency",
        "status",
        "provider_ref",
        "created_at",
        "updated_at",
    ]
    return [dict(zip(keys, row)) for row in rows]


def insert_anpr_event(
    plate: str,
    confidence: float,
    lot_id: str,
    direction: str,
    captured_at: str,
    frame_url: Optional[str] = None,
) -> Dict:
    created_at = datetime.utcnow().isoformat(timespec="seconds")
    with _get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO anpr_events (plate, confidence, lot_id, direction, frame_url, captured_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (plate, confidence, lot_id, direction, frame_url, captured_at, created_at),
        )
        event_id = cursor.lastrowid
    return fetch_anpr_event(event_id)


def fetch_anpr_event(event_id: int) -> Dict:
    with _get_connection() as conn:
        row = conn.execute(
            """
            SELECT id, plate, confidence, lot_id, direction, frame_url, captured_at, created_at
            FROM anpr_events
            WHERE id = ?
            """,
            (event_id,),
        ).fetchone()
    if not row:
        raise ValueError(f"ANPR event {event_id} not found")
    keys = [
        "id",
        "plate",
        "confidence",
        "lot_id",
        "direction",
        "frame_url",
        "captured_at",
        "created_at",
    ]
    return dict(zip(keys, row))


def query_anpr_events(
    plate: Optional[str] = None,
    lot_id: Optional[str] = None,
    since: Optional[str] = None,
    limit: int = 100,
) -> List[Dict]:
    clauses = []
    params: List[str] = []
    if plate:
        clauses.append("plate = ?")
        params.append(plate)
    if lot_id:
        clauses.append("lot_id = ?")
        params.append(lot_id)
    if since:
        clauses.append("captured_at >= ?")
        params.append(since)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    query = f"""
        SELECT id, plate, confidence, lot_id, direction, frame_url, captured_at, created_at
        FROM anpr_events
        {where}
        ORDER BY captured_at DESC
        LIMIT ?
    """
    params.append(limit)
    with _get_connection() as conn:
        rows = conn.execute(query, params).fetchall()
    keys = [
        "id",
        "plate",
        "confidence",
        "lot_id",
        "direction",
        "frame_url",
        "captured_at",
        "created_at",
    ]
    return [dict(zip(keys, row)) for row in rows]


def create_payment(
    amount: float,
    currency: str,
    reservation_id: Optional[int] = None,
    provider_order_id: Optional[str] = None,
) -> Dict:
    created_at = datetime.utcnow().isoformat(timespec="seconds")
    with _get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO payments (reservation_id, amount, currency, status, provider_order_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                reservation_id,
                amount,
                currency,
                "initiated",
                provider_order_id,
                created_at,
                created_at,
            ),
        )
        payment_id = cursor.lastrowid
    return fetch_payment(payment_id)


def update_payment(
    payment_id: int,
    status: str,
    provider_ref: Optional[str] = None,
    provider_order_id: Optional[str] = None,
):
    updated_at = datetime.utcnow().isoformat(timespec="seconds")
    with _get_connection() as conn:
        conn.execute(
            """
            UPDATE payments
            SET status = ?,
                provider_ref = COALESCE(?, provider_ref),
                provider_order_id = COALESCE(?, provider_order_id),
                updated_at = ?
            WHERE id = ?
            """,
            (status, provider_ref, provider_order_id, updated_at, payment_id),
        )
    return fetch_payment(payment_id)


def fetch_payment(payment_id: int) -> Dict:
    with _get_connection() as conn:
        row = conn.execute(
            """
            SELECT
                id,
                reservation_id,
                amount,
                currency,
                status,
                provider_order_id,
                provider_ref,
                created_at,
                updated_at
            FROM payments
            WHERE id = ?
            """,
            (payment_id,),
        ).fetchone()
    if not row:
        raise ValueError(f"Payment {payment_id} not found")
    keys = [
        "id",
        "reservation_id",
        "amount",
        "currency",
        "status",
        "provider_order_id",
        "provider_ref",
        "created_at",
        "updated_at",
    ]
    return dict(zip(keys, row))


def fetch_payment_by_order_id(order_id: str) -> Optional[Dict]:
    with _get_connection() as conn:
        row = conn.execute(
            """
            SELECT
                id,
                reservation_id,
                amount,
                currency,
                status,
                provider_order_id,
                provider_ref,
                created_at,
                updated_at
            FROM payments
            WHERE provider_order_id = ?
            """,
            (order_id,),
        ).fetchone()
    if not row:
        return None
    keys = [
        "id",
        "reservation_id",
        "amount",
        "currency",
        "status",
        "provider_order_id",
        "provider_ref",
        "created_at",
        "updated_at",
    ]
    return dict(zip(keys, row))


def create_pass(
    user_id: int,
    reservation_id: int,
    slot_id: str,
    lot_id: str,
    vehicle_plate: Optional[str],
    start_time: str,
    end_time: str,
    amount: float,
    status: str,
    payment_ref: Optional[str],
    generated_at: Optional[str] = None,
) -> Dict:
    created_at = datetime.utcnow().isoformat(timespec="seconds")
    generated = generated_at or created_at
    with _get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO passes (
                user_id,
                reservation_id,
                slot_id,
                lot_id,
                vehicle_plate,
                start_time,
                end_time,
                amount,
                status,
                payment_ref,
                generated_at,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                reservation_id,
                slot_id,
                lot_id,
                vehicle_plate,
                start_time,
                end_time,
                amount,
                status,
                payment_ref,
                generated,
                created_at,
            ),
        )
        pass_id = cursor.lastrowid
    return fetch_pass(pass_id)


def fetch_pass(pass_id: int) -> Dict:
    with _get_connection() as conn:
        row = conn.execute(
            """
            SELECT
                id,
                user_id,
                reservation_id,
                slot_id,
                lot_id,
                vehicle_plate,
                start_time,
                end_time,
                amount,
                status,
                payment_ref,
                generated_at,
                created_at
            FROM passes
            WHERE id = ?
            """,
            (pass_id,),
        ).fetchone()
    if not row:
        raise ValueError(f"Pass {pass_id} not found")
    keys = [
        "id",
        "user_id",
        "reservation_id",
        "slot_id",
        "lot_id",
        "vehicle_plate",
        "start_time",
        "end_time",
        "amount",
        "status",
        "payment_ref",
        "generated_at",
        "created_at",
    ]
    return dict(zip(keys, row))


def list_user_passes(user_id: int, limit: int = 50) -> List[Dict]:
    with _get_connection() as conn:
        rows = conn.execute(
            """
            SELECT
                id,
                user_id,
                reservation_id,
                slot_id,
                lot_id,
                vehicle_plate,
                start_time,
                end_time,
                amount,
                status,
                payment_ref,
                generated_at,
                created_at
            FROM passes
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (user_id, limit),
        ).fetchall()
    keys = [
        "id",
        "user_id",
        "reservation_id",
        "slot_id",
        "lot_id",
        "vehicle_plate",
        "start_time",
        "end_time",
        "amount",
        "status",
        "payment_ref",
        "generated_at",
        "created_at",
    ]
    return [dict(zip(keys, row)) for row in rows]


# Vehicle management functions
def create_vehicle(user_id: int, license_plate: str, make: Optional[str] = None, model: Optional[str] = None, color: Optional[str] = None) -> Dict:
    created_at = datetime.utcnow().isoformat(timespec="seconds")
    with _get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO vehicles (user_id, license_plate, make, model, color, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (user_id, license_plate.upper(), make, model, color, created_at),
        )
        vehicle_id = cursor.lastrowid
    return fetch_vehicle(vehicle_id)


def fetch_vehicle(vehicle_id: int) -> Dict:
    with _get_connection() as conn:
        row = conn.execute(
            """
            SELECT id, user_id, license_plate, make, model, color, created_at
            FROM vehicles
            WHERE id = ?
            """,
            (vehicle_id,),
        ).fetchone()
    if not row:
        raise ValueError(f"Vehicle {vehicle_id} not found")
    keys = ["id", "user_id", "license_plate", "make", "model", "color", "created_at"]
    return dict(zip(keys, row))


def list_user_vehicles(user_id: int, limit: int = 50) -> List[Dict]:
    with _get_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, user_id, license_plate, make, model, color, created_at
            FROM vehicles
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (user_id, limit),
        ).fetchall()
    keys = ["id", "user_id", "license_plate", "make", "model", "color", "created_at"]
    return [dict(zip(keys, row)) for row in rows]


def update_vehicle(vehicle_id: int, make: Optional[str] = None, model: Optional[str] = None, color: Optional[str] = None) -> Dict:
    with _get_connection() as conn:
        conn.execute(
            """
            UPDATE vehicles
            SET make = COALESCE(?, make),
                model = COALESCE(?, model),
                color = COALESCE(?, color)
            WHERE id = ?
            """,
            (make, model, color, vehicle_id),
        )
    return fetch_vehicle(vehicle_id)


def delete_vehicle(vehicle_id: int) -> None:
    with _get_connection() as conn:
        conn.execute("DELETE FROM vehicles WHERE id = ?", (vehicle_id,))


# Notification management functions
def create_notification(user_id: int, notification_type: str, title: str, message: str) -> Dict:
    created_at = datetime.utcnow().isoformat(timespec="seconds")
    with _get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO notifications (user_id, type, title, message, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (user_id, notification_type, title, message, created_at),
        )
        notification_id = cursor.lastrowid
    return fetch_notification(notification_id)


def fetch_notification(notification_id: int) -> Dict:
    with _get_connection() as conn:
        row = conn.execute(
            """
            SELECT id, user_id, type, title, message, read, created_at
            FROM notifications
            WHERE id = ?
            """,
            (notification_id,),
        ).fetchone()
    if not row:
        raise ValueError(f"Notification {notification_id} not found")
    keys = ["id", "user_id", "type", "title", "message", "read", "created_at"]
    return dict(zip(keys, row))


def list_user_notifications(user_id: int, unread_only: bool = False, limit: int = 100) -> List[Dict]:
    clause = "AND read = 0" if unread_only else ""
    with _get_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT id, user_id, type, title, message, read, created_at
            FROM notifications
            WHERE user_id = ? {clause}
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (user_id, limit),
        ).fetchall()
    keys = ["id", "user_id", "type", "title", "message", "read", "created_at"]
    return [dict(zip(keys, row)) for row in rows]


def mark_notification_read(notification_id: int) -> Dict:
    with _get_connection() as conn:
        conn.execute("UPDATE notifications SET read = 1 WHERE id = ?", (notification_id,))
    return fetch_notification(notification_id)


def mark_all_notifications_read(user_id: int) -> None:
    with _get_connection() as conn:
        conn.execute("UPDATE notifications SET read = 1 WHERE user_id = ?", (user_id,))


def delete_notification(notification_id: int) -> None:
    with _get_connection() as conn:
        conn.execute("DELETE FROM notifications WHERE id = ?", (notification_id,))


# Feedback management functions
def create_feedback(user_id: int, rating: int, comment: Optional[str] = None, reservation_id: Optional[int] = None) -> Dict:
    if not 1 <= rating <= 5:
        raise ValueError("Rating must be between 1 and 5")
    created_at = datetime.utcnow().isoformat(timespec="seconds")
    with _get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO feedback (user_id, reservation_id, rating, comment, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (user_id, reservation_id, rating, comment, created_at),
        )
        feedback_id = cursor.lastrowid
    return fetch_feedback(feedback_id)


def fetch_feedback(feedback_id: int) -> Dict:
    with _get_connection() as conn:
        row = conn.execute(
            """
            SELECT id, user_id, reservation_id, rating, comment, created_at
            FROM feedback
            WHERE id = ?
            """,
            (feedback_id,),
        ).fetchone()
    if not row:
        raise ValueError(f"Feedback {feedback_id} not found")
    keys = ["id", "user_id", "reservation_id", "rating", "comment", "created_at"]
    return dict(zip(keys, row))


def list_user_feedback(user_id: int, limit: int = 50) -> List[Dict]:
    with _get_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, user_id, reservation_id, rating, comment, created_at
            FROM feedback
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (user_id, limit),
        ).fetchall()
    keys = ["id", "user_id", "reservation_id", "rating", "comment", "created_at"]
    return [dict(zip(keys, row)) for row in rows]


def list_all_feedback(limit: int = 100) -> List[Dict]:
    with _get_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, user_id, reservation_id, rating, comment, created_at
            FROM feedback
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    keys = ["id", "user_id", "reservation_id", "rating", "comment", "created_at"]
    return [dict(zip(keys, row)) for row in rows]


# User-specific reservation and payment functions
def list_user_reservations(user_id: int, status: Optional[str] = None, limit: int = 100) -> List[Dict]:
    clauses = ["user_ref = ?"]
    params = [str(user_id)]
    if status:
        clauses.append("status = ?")
        params.append(status)
    where = f"WHERE {' AND '.join(clauses)}"
    query = f"""
        SELECT id, slot_id, lot_id, user_ref, status, start_time, end_time, payment_ref, created_at
        FROM reservations
        {where}
        ORDER BY created_at DESC
        LIMIT ?
    """
    params.append(limit)
    with _get_connection() as conn:
        rows = conn.execute(query, params).fetchall()
    keys = ["id", "slot_id", "lot_id", "user_ref", "status", "start_time", "end_time", "payment_ref", "created_at"]
    return [dict(zip(keys, row)) for row in rows]


def list_user_payments(user_id: int, status: Optional[str] = None, limit: int = 100) -> List[Dict]:
    clauses = ["p.reservation_id IN (SELECT id FROM reservations WHERE user_ref = ?)"]
    params = [str(user_id)]
    if status:
        clauses.append("p.status = ?")
        params.append(status)
    where = f"WHERE {' AND '.join(clauses)}"
    query = f"""
        SELECT p.id, p.reservation_id, p.amount, p.currency, p.status, p.provider_ref, p.created_at, p.updated_at
        FROM payments p
        {where}
        ORDER BY p.created_at DESC
        LIMIT ?
    """
    params.append(limit)
    with _get_connection() as conn:
        rows = conn.execute(query, params).fetchall()
    keys = ["id", "reservation_id", "amount", "currency", "status", "provider_ref", "created_at", "updated_at"]
    return [dict(zip(keys, row)) for row in rows]
