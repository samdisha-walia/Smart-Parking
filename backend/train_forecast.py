"""Baseline forecasting trainer using hourly telemetry aggregates.

Usage:
    python -m backend.train_forecast --horizon 12

Produces backend/forecast_model.json
"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Dict, Tuple

from backend import db

MODEL_PATH = Path(__file__).resolve().parent / "forecast_model.json"
OCCUPIED_LABELS = {"occupied", "car", "vehicle", "busy"}


def load_hourly_stats():
    with db.get_connection() as conn:
        rows = conn.execute(
            "SELECT lot_id, hour_start, total_detections, summary FROM hourly_stats"
        ).fetchall()
    if not rows:
        raise RuntimeError("No hourly stats available. Run the ETL job first.")
    return rows


def hour_of_week(dt: datetime) -> int:
    return dt.weekday() * 24 + dt.hour


def train_baseline() -> Dict:
    rows = load_hourly_stats()
    lot_stats: Dict[str, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    lot_counts: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
    lot_totals: Dict[str, Tuple[int, int]] = defaultdict(lambda: [0, 0])

    for lot_id, hour_start, total, summary_json in rows:
        dt = datetime.fromisoformat(hour_start)
        hour_idx = hour_of_week(dt)
        summary = json.loads(summary_json)
        occupied = sum(
            count
            for label, count in summary.items()
            if label.lower() in OCCUPIED_LABELS
        )
        rate = (occupied / total) if total else 0.0
        lot_stats[lot_id][str(hour_idx)] += rate
        lot_counts[lot_id][str(hour_idx)] += 1
        lot_totals[lot_id][0] += total
        lot_totals[lot_id][1] += 1

    model = {"lots": {}, "updated_at": datetime.utcnow().isoformat(timespec="seconds")}
    for lot_id, hourly_sum in lot_stats.items():
        hourly_avg = {}
        for hour_idx, agg in hourly_sum.items():
            hourly_avg[hour_idx] = agg / lot_counts[lot_id][hour_idx]
        avg_total = (
            lot_totals[lot_id][0] / lot_totals[lot_id][1]
            if lot_totals[lot_id][1]
            else 0
        )
        model["lots"][lot_id] = {
            "hourly_avg_rate": hourly_avg,
            "avg_total": avg_total,
        }

    MODEL_PATH.write_text(json.dumps(model, indent=2))
    return model


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train baseline occupancy forecaster")
    parser.add_argument(
        "--horizon",
        type=int,
        default=12,
        help="Forecast horizon in hours (currently informational)",
    )
    args = parser.parse_args()
    result = train_baseline()
    print(
        f"Saved model for {len(result['lots'])} lots -> {MODEL_PATH} (horizon={args.horizon}h)"
    )
