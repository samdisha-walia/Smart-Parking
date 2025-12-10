"""Hourly aggregation job for parking detections.

Usage:
    python -m backend.etl_hourly --hours 12
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Dict, Tuple

from backend import db


def load_detections(since: datetime | None = None):
    query = "SELECT created_at, lot_id, label FROM detections"
    params = []
    if since is not None:
        query += " WHERE created_at >= ?"
        params.append(since.isoformat(timespec="seconds"))
    with db.get_connection() as conn:
        rows = conn.execute(query, params).fetchall()
    return rows


def run(hours: int) -> None:
    since = datetime.utcnow() - timedelta(hours=hours) if hours else None
    rows = load_detections(since)
    buckets: Dict[Tuple[str, str], Dict[str, int]] = defaultdict(lambda: defaultdict(int))
    totals: Dict[Tuple[str, str], int] = defaultdict(int)

    for created_at, lot_id, label in rows:
        hour_start = datetime.fromisoformat(created_at).replace(minute=0, second=0, microsecond=0)
        hour_key = hour_start.isoformat(timespec="seconds")
        key = (lot_id, hour_key)
        buckets[key][label] += 1
        totals[key] += 1

    for (lot_id, hour_start), summary in buckets.items():
        db.record_hourly_stat(lot_id, hour_start, totals[(lot_id, hour_start)], summary)

    print(f"Processed {len(rows)} detections into {len(buckets)} hourly buckets")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Aggregate detection telemetry into hourly stats")
    parser.add_argument("--hours", type=int, default=24, help="How many past hours to process (0 = all)")
    args = parser.parse_args()
    run(args.hours)
