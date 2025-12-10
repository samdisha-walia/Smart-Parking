"""Utility to backfill telemetry.db with synthetic detection rows.

This script is handy for local development when you need data for the
hourly ETL job and forecast trainer without running the full YOLO
pipeline.
"""
from __future__ import annotations

import argparse
import json
import random
from datetime import datetime, timedelta
from typing import List, Tuple

from backend import db

DetectionRow = Tuple[str, str, str, float, str]


def _random_bbox() -> List[int]:
    x1 = random.randint(0, 640)
    y1 = random.randint(0, 360)
    width = random.randint(40, 160)
    height = random.randint(40, 160)
    return [x1, y1, x1 + width, y1 + height]


def generate_rows(
    lot_id: str,
    hours: int,
    per_hour: int,
    occupied_ratio: float,
) -> List[DetectionRow]:
    """Build detection tuples spanning the past `hours` hours."""
    if hours <= 0 or per_hour <= 0:
        return []

    now = datetime.utcnow().replace(minute=0, second=0, microsecond=0)
    rows: List[DetectionRow] = []

    for hour_offset in range(hours):
        hour_start = now - timedelta(hours=hour_offset)
        for _ in range(per_hour):
            ts = hour_start + timedelta(
                minutes=random.randint(0, 59), seconds=random.randint(0, 59)
            )
            label = "occupied" if random.random() < occupied_ratio else "vacant"
            confidence = round(random.uniform(0.55, 0.99), 3)
            bbox = json.dumps(_random_bbox())
            rows.append(
                (
                    ts.isoformat(timespec="seconds"),
                    lot_id,
                    label,
                    confidence,
                    bbox,
                )
            )

    rows.sort(key=lambda row: row[0])
    return rows


def insert_rows(rows: List[DetectionRow]) -> int:
    if not rows:
        return 0
    with db.get_connection() as conn:
        conn.executemany(
            """
            INSERT INTO detections (created_at, lot_id, label, confidence, bbox)
            VALUES (?, ?, ?, ?, ?)
            """,
            rows,
        )
    return len(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed telemetry detections")
    parser.add_argument("--lot", default="P1", help="Lot identifier")
    parser.add_argument(
        "--hours",
        type=int,
        default=48,
        help="Number of past hours to backfill",
    )
    parser.add_argument(
        "--per-hour",
        type=int,
        default=30,
        help="Detections to create for each hour",
    )
    parser.add_argument(
        "--occupied-ratio",
        type=float,
        default=0.6,
        help="Probability that a detection is tagged as occupied",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="Random seed for reproducible data",
    )

    args = parser.parse_args()

    if args.seed is not None:
        random.seed(args.seed)

    rows = generate_rows(
        lot_id=args.lot,
        hours=args.hours,
        per_hour=args.per_hour,
        occupied_ratio=max(0.0, min(1.0, args.occupied_ratio)),
    )

    inserted = insert_rows(rows)
    print(
        f"Inserted {inserted} detections for lot {args.lot} covering the past {args.hours} hours."
    )


if __name__ == "__main__":
    main()
