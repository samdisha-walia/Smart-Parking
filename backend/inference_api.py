"""FastAPI service that wraps the trained YOLO model for parking-slot inference.

Usage
***
1. Install dependencies:
   pip install fastapi uvicorn ultralytics pillow python-multipart

2. Start the server:
   YOLO_MODEL_PATH=yolov8s.pt uvicorn backend.inference_api:app --reload

3. Send predictions:
   curl -X POST "http://localhost:8000/predict?lot_id=P1" \
        -F "image=@sample.jpg"
"""
from __future__ import annotations

import io
import os
import json
from pathlib import Path
import time
import base64
import hashlib
import hmac
import secrets
import smtplib
from email.message import EmailMessage
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple, Literal

import jwt
from fastapi import (
    File,
    Form,
    HTTPException,
    UploadFile,
    FastAPI,
    Body,
    Query,
    Depends,
    BackgroundTasks,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr
from ultralytics import YOLO
try:
    import razorpay
except ImportError:  # pragma: no cover - optional dependency
    razorpay = None
from PIL import Image

from backend import db

import logging

logger = logging.getLogger(__name__)

CONF_THRESHOLD = float(os.getenv("YOLO_CONF_THRESHOLD", 0.35))
IOU_THRESHOLD = float(os.getenv("YOLO_IOU_THRESHOLD", 0.45))
MODEL_PATH = os.getenv("YOLO_MODEL_PATH", "yolov8s.pt")
BASE_DIR = Path(__file__).resolve().parent
FORECAST_PATH = BASE_DIR / "forecast_model.json"
USERS_SEED_PATH = BASE_DIR / "default_users.json"
_forecast_cache = None
_forecast_mtime = None

JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-key")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "240"))
RESET_TOKEN_EXPIRE_MINUTES = int(os.getenv("RESET_TOKEN_EXPIRE_MINUTES", "30"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))
PASSWORD_ITERATIONS = 390000

SMTP_HOST = os.getenv("SMTP_HOST")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")
SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "true").lower() == "true"
EMAIL_SENDER = os.getenv("EMAIL_FROM", "no-reply@smartpark.local")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
DEFAULT_ADMIN_EMAIL = os.getenv("DEFAULT_ADMIN_EMAIL")
DEFAULT_ADMIN_PASSWORD = os.getenv("DEFAULT_ADMIN_PASSWORD")
RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID")
RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET")

security = HTTPBearer(auto_error=False)


def _hash_password(password: str, salt: Optional[str] = None) -> Tuple[str, str]:
    if salt is None:
        salt = base64.urlsafe_b64encode(secrets.token_bytes(16)).decode("utf-8")
    derived = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        PASSWORD_ITERATIONS,
    )
    password_hash = base64.urlsafe_b64encode(derived).decode("utf-8")
    return password_hash, salt


def _verify_password(password: str, password_hash: str, salt: str) -> bool:
    calculated, _ = _hash_password(password, salt)
    return hmac.compare_digest(calculated, password_hash)


def _create_access_token(user: Dict) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": str(user["id"]),
        "name": user["name"],
        "role": user["role"],
        "exp": expire,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _issue_refresh_token(user_id: int) -> str:
    raw_token = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode("utf-8")
    token_hash = _hash_refresh_token(raw_token)
    expires_at = (
        datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    ).isoformat(timespec="seconds")
    db.store_refresh_token(user_id, token_hash, expires_at)
    return raw_token


def _send_email(subject: str, to_email: str, html_body: str) -> None:
    if not SMTP_HOST or not SMTP_USERNAME or not SMTP_PASSWORD:
        logger.warning("SMTP credentials missing; skipping email to %s", to_email)
        return
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = EMAIL_SENDER
    message["To"] = to_email
    message.set_content(html_body, subtype="html")
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as server:
            if SMTP_USE_TLS:
                server.starttls()
            server.login(SMTP_USERNAME, SMTP_PASSWORD)
            server.send_message(message)
    except Exception as exc:  # pragma: no cover - network
        logger.error("Failed to send email to %s: %s", to_email, exc)


def _ensure_default_users() -> None:
    if DEFAULT_ADMIN_EMAIL and DEFAULT_ADMIN_PASSWORD:
        existing = db.fetch_user_by_email(DEFAULT_ADMIN_EMAIL)
        if not existing:
            password_hash, salt = _hash_password(DEFAULT_ADMIN_PASSWORD)
            db.create_user(
                name="Admin",
                email=DEFAULT_ADMIN_EMAIL,
                password_hash=password_hash,
                salt=salt,
                role="admin",
            )
            logger.info("Created default admin user %s", DEFAULT_ADMIN_EMAIL)
    if USERS_SEED_PATH.exists():
        try:
            payload = json.loads(USERS_SEED_PATH.read_text())
            if isinstance(payload, dict):
                users = payload.get("users", [])
            elif isinstance(payload, list):
                users = payload
            else:
                logger.warning(
                    "Unsupported default_users format (%s); expected dict or list",
                    type(payload).__name__,
                )
                users = []
            for user in users:
                if db.fetch_user_by_email(user["email"]):
                    continue
                password_hash, salt = _hash_password(user["password"])
                db.create_user(
                    name=user.get("name", "User"),
                    email=user["email"],
                    password_hash=password_hash,
                    salt=salt,
                    role=user.get("role", "user"),
                )
        except Exception as exc:
            logger.warning("Failed to seed users from %s: %s", USERS_SEED_PATH, exc)


def _create_reset_token(user_id: int) -> str:
    token = base64.urlsafe_b64encode(secrets.token_bytes(24)).decode("utf-8")
    expires_at = (datetime.utcnow() + timedelta(minutes=RESET_TOKEN_EXPIRE_MINUTES)).isoformat(
        timespec="seconds"
    )
    db.store_reset_token(user_id, token, expires_at)
    return token


def _get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> Dict:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = credentials.credentials
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = db.fetch_user(int(payload["sub"]))
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def _serialize_user(record: Dict) -> UserProfile:
    created_at = record["created_at"]
    if isinstance(created_at, str):
        created_at = datetime.fromisoformat(created_at)
    return UserProfile(
        id=record["id"],
        name=record["name"],
        email=record["email"],
        role=record["role"],
        booking_enabled=bool(record.get("booking_enabled", True)),
        created_at=created_at,
    )


def _serialize_admin_user(record: Dict) -> AdminUserResponse:
    created_at = record["created_at"]
    if isinstance(created_at, str):
        created_at = datetime.fromisoformat(created_at)
    return AdminUserResponse(
        id=record["id"],
        name=record["name"],
        email=record["email"],
        role=record["role"],
        booking_enabled=bool(record.get("booking_enabled", True)),
        created_at=created_at,
    )


def _require_admin(user: Dict) -> None:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin privileges required")


def _issue_auth_response(user: Dict) -> AuthResponse:
    access_token = _create_access_token(user)
    refresh_token = _issue_refresh_token(user["id"])
    return AuthResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=_serialize_user(user),
    )


def _validate_refresh_token(raw_token: str) -> Dict:
    if not raw_token:
        raise HTTPException(status_code=400, detail="Refresh token required")
    token_hash = _hash_refresh_token(raw_token)
    user = db.fetch_user_by_refresh_token(token_hash)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    expires = user.get("refresh_token_expires")
    if not expires:
        raise HTTPException(status_code=401, detail="Refresh token revoked")
    if datetime.fromisoformat(expires) < datetime.utcnow():
        db.store_refresh_token(user["id"], None, None)
        raise HTTPException(status_code=401, detail="Refresh token expired")
    return user


def _validate_password_strength(password: str) -> None:
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if password.lower() == password or password.upper() == password:
        raise HTTPException(status_code=400, detail="Password must contain mixed case letters")
    if not any(ch.isdigit() for ch in password):
        raise HTTPException(status_code=400, detail="Password must include at least one digit")

try:
    model = YOLO(MODEL_PATH)
except Exception as exc:  # pragma: no cover - logs on startup
    raise RuntimeError(f"Failed to load YOLO model from {MODEL_PATH}: {exc}")

app = FastAPI(
    title="Parking Occupancy Inference API",
    description="Real-time detection endpoint powered by the trained YOLO model",
    version="0.1.0",
)


@app.on_event("startup")
def _startup_seed_users():
    _ensure_default_users()

_razorpay_client = None


def _get_razorpay_client():
    global _razorpay_client
    if not RAZORPAY_KEY_ID or not RAZORPAY_KEY_SECRET:
        raise HTTPException(status_code=500, detail="Razorpay credentials not configured")
    if razorpay is None:
        raise HTTPException(
            status_code=500,
            detail="razorpay-python package not installed. Run `pip install razorpay`.",
        )
    if _razorpay_client is None:
        _razorpay_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))
    return _razorpay_client
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def load_image(data: bytes) -> Image.Image:
    try:
        image = Image.open(io.BytesIO(data)).convert("RGB")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid image file: {exc}")
    return image


class UserProfile(BaseModel):
    id: int
    name: str
    email: EmailStr
    role: str
    booking_enabled: bool = True
    created_at: datetime


class AdminUserResponse(BaseModel):
    id: int
    name: str
    email: EmailStr
    role: str
    booking_enabled: bool
    created_at: datetime


class AuthResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserProfile


class BookingAccessUpdate(BaseModel):
    enabled: bool


class UserRoleUpdate(BaseModel):
    role: Literal["user", "admin"]


class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


class MessageResponse(BaseModel):
    message: str


class RefreshRequest(BaseModel):
    refresh_token: str


@app.post("/auth/register", response_model=AuthResponse, status_code=201)
def register(payload: RegisterRequest):
    if db.fetch_user_by_email(payload.email):
        raise HTTPException(status_code=409, detail="Email already registered")
    _validate_password_strength(payload.password)
    password_hash, salt = _hash_password(payload.password)
    record = db.create_user(
        name=payload.name,
        email=payload.email,
        password_hash=password_hash,
        salt=salt,
        role="user",
    )
    return _issue_auth_response(record)


@app.post("/auth/login", response_model=AuthResponse)
def login(payload: LoginRequest):
    user = db.fetch_user_by_email(payload.email)
    if not user or not _verify_password(payload.password, user["password_hash"], user["salt"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return _issue_auth_response(user)


@app.get("/auth/me", response_model=UserProfile)
def get_me(current_user: Dict = Depends(_get_current_user)):
    return _serialize_user(current_user)


@app.post("/auth/forgot-password", response_model=MessageResponse)
def forgot_password(payload: ForgotPasswordRequest, background: BackgroundTasks):
    user = db.fetch_user_by_email(payload.email)
    if not user:
        return MessageResponse(message="If the account exists, a reset link was sent.")
    token = _create_reset_token(user["id"])
    reset_url = f"{FRONTEND_URL.rstrip('/')}/reset-password?token={token}"
    subject = "Reset your SmartPark password"
    html_body = f"""
    <p>Hi {user['name']},</p>
    <p>Click the link below to reset your password. It expires in {RESET_TOKEN_EXPIRE_MINUTES} minutes.</p>
    <p><a href="{reset_url}">{reset_url}</a></p>
    <p>If you did not request this, ignore this email.</p>
    """
    background.add_task(_send_email, subject, user["email"], html_body)
    return MessageResponse(message="If the account exists, a reset link was sent.")


@app.post("/auth/reset-password", response_model=MessageResponse)
def reset_password(payload: ResetPasswordRequest):
    user = db.fetch_user_by_reset_token(payload.token)
    if not user:
        raise HTTPException(status_code=400, detail="Invalid reset token")
    expires = user.get("reset_token_expires")
    if not expires or datetime.fromisoformat(expires) < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Reset token expired")
    _validate_password_strength(payload.new_password)
    password_hash, salt = _hash_password(payload.new_password)
    db.update_user_password(user["id"], password_hash, salt)
    return MessageResponse(message="Password updated successfully")


@app.post("/auth/refresh", response_model=AuthResponse)
def refresh_access_token(payload: RefreshRequest):
    user = _validate_refresh_token(payload.refresh_token)
    return _issue_auth_response(user)


@app.post("/auth/logout", response_model=MessageResponse)
def logout(payload: RefreshRequest):
    user = _validate_refresh_token(payload.refresh_token)
    db.store_refresh_token(user["id"], None, None)
    return MessageResponse(message="Session revoked")


class SlotDetection(BaseModel):
    label: str
    confidence: float
    bbox: List[float]


class PredictionResponse(BaseModel):
    lot_id: str
    total_detections: int
    occupancy_breakdown: Dict[str, int]
    slots: List[SlotDetection]


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok", "model": MODEL_PATH}


@app.post("/predict", response_model=PredictionResponse)
async def predict(
    image: UploadFile = File(..., description="Parking-lot frame"),
    lot_id: str = Form("unspecified"),
) -> PredictionResponse:
    contents = await image.read()
    frame = load_image(contents)

    results = model.predict(
        source=frame,
        conf=CONF_THRESHOLD,
        iou=IOU_THRESHOLD,
        verbose=False,
    )
    if not results:
        raise HTTPException(status_code=500, detail="Model returned no results")

    detections: List[SlotDetection] = []
    breakdown: Dict[str, int] = {}

    for box in results[0].boxes:
        cls_id = int(box.cls)
        label = model.names.get(cls_id, f"cls_{cls_id}")
        confidence = float(box.conf)
        xyxy = box.xyxy[0].tolist()
        detections.append(
            SlotDetection(label=label, confidence=confidence, bbox=xyxy)
        )
        breakdown[label] = breakdown.get(label, 0) + 1

    db.record_detections(
        lot_id,
        [
            {
                "label": det.label,
                "confidence": det.confidence,
                "bbox": det.bbox,
            }
            for det in detections
        ],
    )

    return PredictionResponse(
        lot_id=lot_id,
        total_detections=len(detections),
        occupancy_breakdown=breakdown,
        slots=detections,
    )


@app.post("/mock/stream")
async def register_stream(rtsp_url: str = Form(...)) -> Dict[str, str]:
    # Placeholder endpoint for wiring RTSP/HTTP video sources.
    # In production, this would launch a worker that continuously pulls
    # frames, feeds them through `model.predict`, and stores slot telemetry.
    return {"message": "Stream registration stub", "rtsp": rtsp_url}


class SlotSnapshot(BaseModel):
    lot_id: str
    window_minutes: int
    counts: Dict[str, int]
    recent: List[SlotDetection]


@app.get("/slots/{lot_id}/snapshot", response_model=SlotSnapshot)
def get_slot_snapshot(lot_id: str, window_minutes: int = 15, recent_limit: int = 25):
    counts = db.fetch_snapshot_counts(lot_id, window_minutes)
    raw_recent = db.fetch_recent_detections(lot_id, recent_limit)
    recent = [
        SlotDetection(
            label=rec["label"],
            confidence=rec["confidence"],
            bbox=rec["bbox"],
        )
        for rec in raw_recent
    ]
    return SlotSnapshot(
        lot_id=lot_id,
        window_minutes=window_minutes,
        counts=counts,
        recent=recent,
    )


def _load_forecast_model() -> Dict:
    global _forecast_cache, _forecast_mtime
    try:
        mtime = FORECAST_PATH.stat().st_mtime
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="Forecast model not trained yet")
    if _forecast_cache is None or mtime != _forecast_mtime:
        _forecast_cache = json.loads(FORECAST_PATH.read_text())
        _forecast_mtime = mtime
    return _forecast_cache


def _hour_of_week(dt: datetime) -> int:
    return dt.weekday() * 24 + dt.hour


class ForecastPoint(BaseModel):
    timestamp: datetime
    occupancy_rate: float
    estimated_total: float
    estimated_occupied: float
    estimated_available: float


class ForecastResponse(BaseModel):
    lot_id: str
    generated_at: datetime
    horizon_hours: int
    points: List[ForecastPoint]


@app.get("/lots/{lot_id}/forecast", response_model=ForecastResponse)
def get_forecast(lot_id: str, hours: int = 12):
    model_payload = _load_forecast_model()
    lot_model = model_payload.get("lots", {}).get(lot_id)
    if not lot_model:
        raise HTTPException(status_code=404, detail=f"No forecast for lot {lot_id}")
    now = datetime.utcnow().replace(minute=0, second=0, microsecond=0)
    points: List[ForecastPoint] = []
    total = float(lot_model.get("avg_total", 0))
    for step in range(hours):
        ts = now + timedelta(hours=step)
        hour_idx = str(_hour_of_week(ts))
        rate = float(lot_model.get("hourly_avg_rate", {}).get(hour_idx, 0))
        estimated_occupied = max(0.0, min(total, rate * total))
        estimated_available = max(0.0, total - estimated_occupied)
        points.append(
            ForecastPoint(
                timestamp=ts,
                occupancy_rate=rate,
                estimated_total=total,
                estimated_occupied=estimated_occupied,
                estimated_available=estimated_available,
            )
        )
    return ForecastResponse(
        lot_id=lot_id,
        generated_at=datetime.utcnow(),
        horizon_hours=hours,
        points=points,
    )


class ReservationRequest(BaseModel):
    slot_id: str
    lot_id: str
    start_time: datetime
    end_time: datetime


class ReservationResponse(BaseModel):
    id: int
    slot_id: str
    lot_id: str
    user_ref: str
    status: str
    start_time: datetime
    end_time: datetime
    payment_ref: str | None = None
    created_at: datetime


class ReservationConfirmRequest(BaseModel):
    payment_ref: str
    status: str = "confirmed"


def _serialize_reservation(res: Dict) -> ReservationResponse:
    payload = res.copy()
    payload["start_time"] = datetime.fromisoformat(res["start_time"])
    payload["end_time"] = datetime.fromisoformat(res["end_time"])
    payload["created_at"] = datetime.fromisoformat(res["created_at"])
    return ReservationResponse(**payload)


def _ensure_booking_enabled(user: Dict) -> None:
    if not bool(user.get("booking_enabled", True)):
        raise HTTPException(status_code=403, detail="Booking access disabled by admin")


@app.post("/reservations", response_model=ReservationResponse, status_code=201)
def create_reservation(
    reservation: ReservationRequest,
    current_user: Dict = Depends(_get_current_user),
):
    _ensure_booking_enabled(current_user)
    record = db.create_reservation(
        slot_id=reservation.slot_id,
        lot_id=reservation.lot_id,
        user_ref=str(current_user["id"]),
        start_time=reservation.start_time.isoformat(timespec="seconds"),
        end_time=reservation.end_time.isoformat(timespec="seconds"),
    )
    return _serialize_reservation(record)


@app.get("/reservations", response_model=List[ReservationResponse])
def list_reservations(
    status: str | None = Query(default=None),
    limit: int = Query(default=100, le=500),
    current_user: Dict = Depends(_get_current_user),
):
    _require_admin(current_user)
    records = db.list_reservations(status=status, limit=limit)
    return [_serialize_reservation(record) for record in records]


@app.post("/reservations/{reservation_id}/confirm", response_model=ReservationResponse)
def confirm_reservation(reservation_id: int, payload: ReservationConfirmRequest):
    try:
        updated = db.update_reservation_status(
            reservation_id, payload.status, payload.payment_ref
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return _serialize_reservation(updated)


class AnprEvent(BaseModel):
    id: int
    plate: str
    confidence: float
    lot_id: str
    direction: str
    frame_url: str | None = None
    captured_at: datetime
    created_at: datetime


class AnprEventCreate(BaseModel):
    plate: str
    confidence: float
    lot_id: str
    direction: str
    captured_at: datetime
    frame_url: str | None = None


def _serialize_anpr(record: Dict) -> AnprEvent:
    return AnprEvent(
        **record,
        captured_at=datetime.fromisoformat(record["captured_at"]),
        created_at=datetime.fromisoformat(record["created_at"]),
    )


@app.post("/anpr/events", response_model=AnprEvent, status_code=201)
def create_anpr_event(payload: AnprEventCreate):
    record = db.insert_anpr_event(
        plate=payload.plate,
        confidence=payload.confidence,
        lot_id=payload.lot_id,
        direction=payload.direction,
        captured_at=payload.captured_at.isoformat(timespec="seconds"),
        frame_url=payload.frame_url,
    )
    return _serialize_anpr(record)


@app.get("/anpr/events", response_model=List[AnprEvent])
def list_anpr_events(
    plate: str | None = Query(default=None),
    lot_id: str | None = Query(default=None),
    since: datetime | None = Query(default=None),
    limit: int = Query(default=100, le=500),
    current_user: Dict = Depends(_get_current_user),
):
    _require_admin(current_user)
    records = db.query_anpr_events(
        plate=plate,
        lot_id=lot_id,
        since=since.isoformat(timespec="seconds") if since else None,
        limit=limit,
    )
    return [_serialize_anpr(rec) for rec in records]


class WebhookRegistration(BaseModel):
    callback_url: str
    secret: str | None = None


@app.post("/anpr/webhooks")
def register_anpr_webhook(payload: WebhookRegistration):
    # Placeholder: In production, persist webhook subscriptions and enqueue delivery events.
    return {"message": "Webhook registration stub", "callback_url": payload.callback_url}


class PaymentInitiateRequest(BaseModel):
    amount: float
    currency: str = "INR"
    reservation_id: int | None = None


class PaymentResponse(BaseModel):
    id: int
    reservation_id: int | None
    amount: float
    currency: str
    status: str
    provider_order_id: str | None = None
    provider_ref: str | None
    created_at: datetime
    updated_at: datetime


class PaymentConfirmRequest(BaseModel):
    status: str = "succeeded"
    provider_ref: str


class PassResponse(BaseModel):
    id: int
    reservation_id: int
    slot_id: str
    lot_id: str
    vehicle_plate: str | None = None
    start_time: datetime
    end_time: datetime
    amount: float
    status: str
    payment_ref: str | None = None
    generated_at: datetime
    created_at: datetime


class PassCreate(BaseModel):
    reservation_id: int
    slot_id: str
    lot_id: str
    vehicle_plate: str | None = None
    start_time: datetime
    end_time: datetime
    amount: float
    status: str
    payment_ref: str | None = None


class RazorpayOrderCreateRequest(BaseModel):
    amount: float
    currency: str = "INR"
    reservation_id: int | None = None
    receipt: str | None = None
    notes: dict | None = None


class RazorpayOrderCreateResponse(BaseModel):
    order_id: str
    amount: int
    currency: str
    key_id: str
    payment_id: int
    reservation_id: int | None = None


class RazorpayVerifyRequest(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str
    reservation_id: int | None = None


# Vehicle models
class VehicleCreate(BaseModel):
    license_plate: str
    make: str | None = None
    model: str | None = None
    color: str | None = None


class VehicleUpdate(BaseModel):
    make: str | None = None
    model: str | None = None
    color: str | None = None


class VehicleResponse(BaseModel):
    id: int
    user_id: int
    license_plate: str
    make: str | None = None
    model: str | None = None
    color: str | None = None
    created_at: datetime


# Notification models
class NotificationResponse(BaseModel):
    id: int
    user_id: int
    type: str
    title: str
    message: str
    read: bool
    created_at: datetime


# Feedback models
class FeedbackCreate(BaseModel):
    rating: int
    comment: str | None = None
    reservation_id: int | None = None


class FeedbackResponse(BaseModel):
    id: int
    user_id: int
    reservation_id: int | None = None
    rating: int
    comment: str | None = None
    created_at: datetime


# Razorpay integration models
class RazorpayOrderRequest(BaseModel):
    amount: float
    currency: str = "INR"
    receipt: str | None = None
    notes: dict | None = None


class RazorpayOrderResponse(BaseModel):
    id: str
    entity: str
    amount: int
    amount_paid: int
    amount_due: int
    currency: str
    receipt: str | None = None
    offer_id: str | None = None
    status: str
    attempts: int
    notes: dict | None = None
    created_at: int


class ParkingZoneCreate(BaseModel):
    zone_code: str
    name: str
    level: str | None = None
    description: str | None = None
    total_slots: int = 0
    ev_slots: int = 0
    vip_slots: int = 0


class ParkingZoneUpdate(BaseModel):
    name: str | None = None
    level: str | None = None
    description: str | None = None
    total_slots: int | None = None
    ev_slots: int | None = None
    vip_slots: int | None = None


class ParkingSlotCreate(BaseModel):
    zone_id: int
    slot_id: str
    slot_type: str = "normal"
    price_per_hour: float = 50.0
    metadata: Dict[str, Any] | None = None


class ParkingSlotUpdate(BaseModel):
    zone_id: int | None = None
    slot_type: str | None = None
    status: str | None = None
    price_per_hour: float | None = None
    metadata: Dict[str, Any] | None = None


class ParkingSlotResponse(BaseModel):
    id: int
    zone_id: int
    slot_id: str
    slot_type: str
    status: str
    price_per_hour: float
    metadata: Dict[str, Any] | None = None
    updated_at: datetime


class ParkingZoneResponse(BaseModel):
    id: int
    zone_code: str
    name: str
    level: str | None = None
    description: str | None = None
    total_slots: int
    ev_slots: int
    vip_slots: int
    created_at: datetime
    updated_at: datetime
    slots: List[ParkingSlotResponse] | None = None


class CameraCreate(BaseModel):
    name: str
    stream_url: str
    zone_id: int | None = None


class CameraUpdate(BaseModel):
    name: str | None = None
    stream_url: str | None = None
    zone_id: int | None = None
    status: str | None = None


class CameraResponse(BaseModel):
    id: int
    zone_id: int | None
    name: str
    stream_url: str
    status: str
    last_heartbeat: datetime | None = None
    created_at: datetime


class CameraHeartbeat(BaseModel):
    status: str | None = None


class PricingRuleCreate(BaseModel):
    name: str
    base_rate: float
    multiplier: float = 1.0
    applies_to: str = "global"
    schedule: str | None = None
    active: bool = True


class PricingRuleUpdate(BaseModel):
    name: str | None = None
    base_rate: float | None = None
    multiplier: float | None = None
    applies_to: str | None = None
    schedule: str | None = None
    active: bool | None = None


class PricingRuleResponse(BaseModel):
    id: int
    name: str
    applies_to: str
    base_rate: float
    multiplier: float
    schedule: str | None
    active: bool
    created_at: datetime
    updated_at: datetime


class SystemMetricCreate(BaseModel):
    metric: str
    status: str
    value: float | None = None
    details: Dict[str, Any] | None = None


class SystemMetricResponse(BaseModel):
    id: int
    metric: str
    status: str
    value: float | None
    details: Dict[str, Any] | None
    recorded_at: datetime


class RevenueBucket(BaseModel):
    bucket: str
    revenue: float
    transactions: int


class OccupancyTrendPoint(BaseModel):
    hour_start: str
    total_detections: int
    summary: Dict[str, int]


class ActiveReservationBucket(BaseModel):
    lot_id: str
    status: str
    count: int


def _serialize_payment(record: Dict) -> PaymentResponse:
    payload = record.copy()
    payload["created_at"] = datetime.fromisoformat(record["created_at"])
    payload["updated_at"] = datetime.fromisoformat(record["updated_at"])
    return PaymentResponse(**payload)


def _serialize_pass(record: Dict) -> PassResponse:
    payload = record.copy()
    payload["start_time"] = datetime.fromisoformat(record["start_time"])
    payload["end_time"] = datetime.fromisoformat(record["end_time"])
    payload["generated_at"] = datetime.fromisoformat(record["generated_at"])
    payload["created_at"] = datetime.fromisoformat(record["created_at"])
    return PassResponse(**payload)


def _serialize_zone(record: Dict, include_slots: bool = False) -> ParkingZoneResponse:
    payload = record.copy()
    payload["created_at"] = datetime.fromisoformat(record["created_at"])
    payload["updated_at"] = datetime.fromisoformat(record["updated_at"])
    if include_slots and "slots" in payload:
        payload["slots"] = [_serialize_slot(slot) for slot in payload["slots"]]
    return ParkingZoneResponse(**payload)


def _serialize_slot(record: Dict) -> ParkingSlotResponse:
    payload = record.copy()
    payload["updated_at"] = datetime.fromisoformat(record["updated_at"])
    return ParkingSlotResponse(**payload)


def _serialize_camera(record: Dict) -> CameraResponse:
    payload = record.copy()
    payload["created_at"] = datetime.fromisoformat(record["created_at"])
    last = record.get("last_heartbeat")
    payload["last_heartbeat"] = datetime.fromisoformat(last) if last else None
    return CameraResponse(**payload)


def _serialize_pricing_rule(record: Dict) -> PricingRuleResponse:
    payload = record.copy()
    payload["created_at"] = datetime.fromisoformat(record["created_at"])
    payload["updated_at"] = datetime.fromisoformat(record["updated_at"])
    return PricingRuleResponse(**payload)


def _serialize_system_metric(record: Dict) -> SystemMetricResponse:
    payload = record.copy()
    payload["recorded_at"] = datetime.fromisoformat(record["recorded_at"])
    return SystemMetricResponse(**payload)


@app.post("/payments", response_model=PaymentResponse, status_code=201)
def initiate_payment(payload: PaymentInitiateRequest):
    record = db.create_payment(
        amount=payload.amount,
        currency=payload.currency,
        reservation_id=payload.reservation_id,
    )
    return _serialize_payment(record)


@app.get("/payments", response_model=List[PaymentResponse])
def list_payments(
    status: str | None = Query(default=None),
    limit: int = Query(default=100, le=500),
    current_user: Dict = Depends(_get_current_user),
):
    _require_admin(current_user)
    records = db.list_payments(status=status, limit=limit)
    return [_serialize_payment(rec) for rec in records]


@app.post("/payments/{payment_id}/confirm", response_model=PaymentResponse)
def confirm_payment(
    payment_id: int,
    payload: PaymentConfirmRequest,
    current_user: Dict = Depends(_get_current_user),
):
    _require_admin(current_user)
    try:
        record = db.update_payment(
            payment_id=payment_id,
            status=payload.status,
            provider_ref=payload.provider_ref,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return _serialize_payment(record)


@app.get("/payments/{payment_id}", response_model=PaymentResponse)
def get_payment(payment_id: int):
    try:
        record = db.fetch_payment(payment_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return _serialize_payment(record)


# Serialization functions for new models
def _serialize_vehicle(record: Dict) -> VehicleResponse:
    payload = record.copy()
    payload["created_at"] = datetime.fromisoformat(record["created_at"])
    return VehicleResponse(**payload)


def _serialize_notification(record: Dict) -> NotificationResponse:
    payload = record.copy()
    payload["created_at"] = datetime.fromisoformat(record["created_at"])
    payload["read"] = bool(record["read"])
    return NotificationResponse(**payload)


def _serialize_feedback(record: Dict) -> FeedbackResponse:
    payload = record.copy()
    payload["created_at"] = datetime.fromisoformat(record["created_at"])
    return FeedbackResponse(**payload)


# Vehicle endpoints
@app.post("/user/vehicles", response_model=VehicleResponse, status_code=201)
def create_vehicle(payload: VehicleCreate, current_user: Dict = Depends(_get_current_user)):
    try:
        record = db.create_vehicle(
            user_id=current_user["id"],
            license_plate=payload.license_plate,
            make=payload.make,
            model=payload.model,
            color=payload.color,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _serialize_vehicle(record)


@app.get("/user/vehicles", response_model=List[VehicleResponse])
def list_user_vehicles(
    limit: int = Query(default=50, le=100),
    current_user: Dict = Depends(_get_current_user),
):
    records = db.list_user_vehicles(user_id=current_user["id"], limit=limit)
    return [_serialize_vehicle(record) for record in records]


@app.put("/user/vehicles/{vehicle_id}", response_model=VehicleResponse)
def update_vehicle(
    vehicle_id: int,
    payload: VehicleUpdate,
    current_user: Dict = Depends(_get_current_user),
):
    try:
        # Verify ownership
        vehicle = db.fetch_vehicle(vehicle_id)
        if vehicle["user_id"] != current_user["id"]:
            raise HTTPException(status_code=403, detail="Not your vehicle")
        
        record = db.update_vehicle(
            vehicle_id=vehicle_id,
            make=payload.make,
            model=payload.model,
            color=payload.color,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return _serialize_vehicle(record)


@app.delete("/user/vehicles/{vehicle_id}", response_model=MessageResponse)
def delete_vehicle(
    vehicle_id: int,
    current_user: Dict = Depends(_get_current_user),
):
    try:
        # Verify ownership
        vehicle = db.fetch_vehicle(vehicle_id)
        if vehicle["user_id"] != current_user["id"]:
            raise HTTPException(status_code=403, detail="Not your vehicle")
        
        db.delete_vehicle(vehicle_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return MessageResponse(message="Vehicle deleted successfully")


# Notification endpoints
@app.get("/user/notifications", response_model=List[NotificationResponse])
def list_user_notifications(
    unread_only: bool = Query(default=False),
    limit: int = Query(default=100, le=200),
    current_user: Dict = Depends(_get_current_user),
):
    records = db.list_user_notifications(
        user_id=current_user["id"], unread_only=unread_only, limit=limit
    )
    return [_serialize_notification(record) for record in records]


@app.put("/user/notifications/{notification_id}/read", response_model=NotificationResponse)
def mark_notification_read(
    notification_id: int,
    current_user: Dict = Depends(_get_current_user),
):
    try:
        # Verify ownership
        notification = db.fetch_notification(notification_id)
        if notification["user_id"] != current_user["id"]:
            raise HTTPException(status_code=403, detail="Not your notification")
        
        record = db.mark_notification_read(notification_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return _serialize_notification(record)


@app.put("/user/notifications/read-all", response_model=MessageResponse)
def mark_all_notifications_read(current_user: Dict = Depends(_get_current_user)):
    db.mark_all_notifications_read(user_id=current_user["id"])
    return MessageResponse(message="All notifications marked as read")


@app.delete("/user/notifications/{notification_id}", response_model=MessageResponse)
def delete_notification(
    notification_id: int,
    current_user: Dict = Depends(_get_current_user),
):
    try:
        # Verify ownership
        notification = db.fetch_notification(notification_id)
        if notification["user_id"] != current_user["id"]:
            raise HTTPException(status_code=403, detail="Not your notification")
        
        db.delete_notification(notification_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return MessageResponse(message="Notification deleted successfully")


# Feedback endpoints
@app.post("/user/feedback", response_model=FeedbackResponse, status_code=201)
def create_feedback(
    payload: FeedbackCreate,
    current_user: Dict = Depends(_get_current_user),
):
    if not 1 <= payload.rating <= 5:
        raise HTTPException(status_code=400, detail="Rating must be between 1 and 5")
    
    try:
        record = db.create_feedback(
            user_id=current_user["id"],
            rating=payload.rating,
            comment=payload.comment,
            reservation_id=payload.reservation_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _serialize_feedback(record)


@app.get("/user/feedback", response_model=List[FeedbackResponse])
def list_user_feedback(
    limit: int = Query(default=50, le=100),
    current_user: Dict = Depends(_get_current_user),
):
    records = db.list_user_feedback(user_id=current_user["id"], limit=limit)
    return [_serialize_feedback(record) for record in records]


@app.get("/feedback", response_model=List[FeedbackResponse])
def list_all_feedback(
    limit: int = Query(default=100, le=500),
    current_user: Dict = Depends(_get_current_user),
):
    _require_admin(current_user)
    records = db.list_all_feedback(limit=limit)
    return [_serialize_feedback(record) for record in records]


# User-specific reservation and payment endpoints
@app.get("/user/reservations", response_model=List[ReservationResponse])
def list_user_reservations(
    status: str | None = Query(default=None),
    limit: int = Query(default=100, le=500),
    current_user: Dict = Depends(_get_current_user),
):
    records = db.list_user_reservations(user_id=current_user["id"], status=status, limit=limit)
    return [_serialize_reservation(record) for record in records]


@app.get("/user/payments", response_model=List[PaymentResponse])
def list_user_payments(
    status: str | None = Query(default=None),
    limit: int = Query(default=100, le=500),
    current_user: Dict = Depends(_get_current_user),
):
    records = db.list_user_payments(user_id=current_user["id"], status=status, limit=limit)
    return [_serialize_payment(record) for record in records]


@app.get("/user/passes", response_model=List[PassResponse])
def list_user_passes(
    limit: int = Query(default=100, le=200),
    current_user: Dict = Depends(_get_current_user),
):
    records = db.list_user_passes(user_id=current_user["id"], limit=limit)
    return [_serialize_pass(record) for record in records]


@app.post("/user/passes", response_model=PassResponse, status_code=201)
def create_user_pass(
    payload: PassCreate,
    current_user: Dict = Depends(_get_current_user),
):
    record = db.create_pass(
        user_id=current_user["id"],
        reservation_id=payload.reservation_id,
        slot_id=payload.slot_id,
        lot_id=payload.lot_id,
        vehicle_plate=payload.vehicle_plate,
        start_time=payload.start_time.isoformat(),
        end_time=payload.end_time.isoformat(),
        amount=payload.amount,
        status=payload.status,
        payment_ref=payload.payment_ref,
        generated_at=datetime.utcnow().isoformat(timespec="seconds"),
    )
    return _serialize_pass(record)


@app.post("/zones", response_model=ParkingZoneResponse, status_code=201)
def create_zone(
    payload: ParkingZoneCreate,
    current_user: Dict = Depends(_get_current_user),
):
    _require_admin(current_user)
    try:
        record = db.create_parking_zone(
            zone_code=payload.zone_code,
            name=payload.name,
            level=payload.level,
            description=payload.description,
            total_slots=payload.total_slots,
            ev_slots=payload.ev_slots,
            vip_slots=payload.vip_slots,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _serialize_zone(record)


@app.get("/zones", response_model=List[ParkingZoneResponse])
def list_zones(
    include_slots: bool = Query(default=False),
    current_user: Dict = Depends(_get_current_user),
):
    _require_admin(current_user)
    records = db.list_parking_zones(include_slots=include_slots)
    return [_serialize_zone(rec, include_slots=include_slots) for rec in records]


@app.patch("/zones/{zone_id}", response_model=ParkingZoneResponse)
def update_zone(
    zone_id: int,
    payload: ParkingZoneUpdate,
    current_user: Dict = Depends(_get_current_user),
):
    _require_admin(current_user)
    fields = {k: v for k, v in payload.dict(exclude_unset=True).items()}
    try:
        record = db.update_parking_zone(zone_id, **fields)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _serialize_zone(record)


@app.post("/slots", response_model=ParkingSlotResponse, status_code=201)
def create_slot(
    payload: ParkingSlotCreate,
    current_user: Dict = Depends(_get_current_user),
):
    _require_admin(current_user)
    try:
        record = db.create_parking_slot(
            zone_id=payload.zone_id,
            slot_code=payload.slot_id,
            slot_type=payload.slot_type,
            price_per_hour=payload.price_per_hour,
            metadata=payload.metadata,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _serialize_slot(record)


@app.post("/cameras", response_model=CameraResponse, status_code=201)
def register_camera(
    payload: CameraCreate,
    current_user: Dict = Depends(_get_current_user),
):
    _require_admin(current_user)
    try:
        record = db.register_camera_source(
            name=payload.name,
            stream_url=payload.stream_url,
            zone_id=payload.zone_id,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _serialize_camera(record)


@app.get("/cameras", response_model=List[CameraResponse])
def list_cameras(
    zone_id: int | None = Query(default=None),
    current_user: Dict = Depends(_get_current_user),
):
    _require_admin(current_user)
    records = db.list_camera_sources(zone_id=zone_id)
    return [_serialize_camera(rec) for rec in records]


@app.patch("/cameras/{camera_id}", response_model=CameraResponse)
def update_camera(
    camera_id: int,
    payload: CameraUpdate,
    current_user: Dict = Depends(_get_current_user),
):
    _require_admin(current_user)
    fields = {k: v for k, v in payload.dict(exclude_unset=True).items()}
    try:
        record = db.update_camera_source(camera_id, **fields)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _serialize_camera(record)


@app.post("/cameras/{camera_id}/heartbeat", response_model=CameraResponse)
def camera_heartbeat(
    camera_id: int,
    payload: CameraHeartbeat,
):
    try:
        record = db.record_camera_heartbeat(camera_id, status=payload.status)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return _serialize_camera(record)


@app.post("/pricing-rules", response_model=PricingRuleResponse, status_code=201)
def create_pricing_rule(
    payload: PricingRuleCreate,
    current_user: Dict = Depends(_get_current_user),
):
    _require_admin(current_user)
    record = db.upsert_pricing_rule(
        name=payload.name,
        base_rate=payload.base_rate,
        multiplier=payload.multiplier,
        applies_to=payload.applies_to,
        schedule=payload.schedule,
        active=payload.active,
    )
    return _serialize_pricing_rule(record)


@app.patch("/pricing-rules/{rule_id}", response_model=PricingRuleResponse)
def update_pricing_rule(
    rule_id: int,
    payload: PricingRuleUpdate,
    current_user: Dict = Depends(_get_current_user),
):
    _require_admin(current_user)
    fields = payload.dict(exclude_unset=True)
    record = db.upsert_pricing_rule(rule_id=rule_id, **fields)
    return _serialize_pricing_rule(record)


@app.get("/pricing-rules", response_model=List[PricingRuleResponse])
def list_pricing_rules_endpoint(
    active_only: bool = Query(default=False),
    current_user: Dict = Depends(_get_current_user),
):
    _require_admin(current_user)
    records = db.list_pricing_rules(active_only=active_only)
    return [_serialize_pricing_rule(rec) for rec in records]


@app.post("/system-metrics", response_model=SystemMetricResponse, status_code=201)
def record_metric(
    payload: SystemMetricCreate,
    current_user: Dict = Depends(_get_current_user),
):
    _require_admin(current_user)
    record = db.record_system_metric(
        metric=payload.metric,
        status=payload.status,
        value=payload.value,
        details=payload.details,
    )
    return _serialize_system_metric(record)


@app.get("/system-metrics", response_model=List[SystemMetricResponse])
def list_metrics(
    metric: str | None = Query(default=None),
    limit: int = Query(default=100, le=500),
    current_user: Dict = Depends(_get_current_user),
):
    _require_admin(current_user)
    records = db.list_system_metrics(metric=metric, limit=limit)
    return [_serialize_system_metric(rec) for rec in records]


@app.get("/analytics/revenue", response_model=List[RevenueBucket])
def revenue_analytics(
    group_by: str = Query(default="day", pattern="^(day|week|month)$"),
    limit: int = Query(default=30, le=120),
    current_user: Dict = Depends(_get_current_user),
):
    _require_admin(current_user)
    try:
        records = db.revenue_summary(group_by=group_by, limit=limit)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return [RevenueBucket(**rec) for rec in records]


@app.get("/analytics/transactions", response_model=List[PaymentResponse])
def transaction_history(
    limit: int = Query(default=100, le=500),
    current_user: Dict = Depends(_get_current_user),
):
    _require_admin(current_user)
    records = db.transaction_log(limit=limit)
    return [_serialize_payment(rec) for rec in records]


@app.get("/analytics/occupancy", response_model=List[OccupancyTrendPoint])
def occupancy_analytics(
    lot_id: str,
    hours: int = Query(default=24, le=168),
    current_user: Dict = Depends(_get_current_user),
):
    _require_admin(current_user)
    records = db.occupancy_trends(lot_id=lot_id, hours=hours)
    return [OccupancyTrendPoint(**rec) for rec in records]


@app.get("/analytics/active-reservations", response_model=List[ActiveReservationBucket])
def active_reservations(
    current_user: Dict = Depends(_get_current_user),
):
    _require_admin(current_user)
    records = db.active_reservations_by_zone()
    return [ActiveReservationBucket(**rec) for rec in records]


@app.get("/admin/users", response_model=List[AdminUserResponse])
def list_users_endpoint(
    role: str | None = Query(default=None),
    limit: int = Query(default=200, le=500),
    current_user: Dict = Depends(_get_current_user),
):
    _require_admin(current_user)
    records = db.list_users(role=role, limit=limit)
    return [_serialize_admin_user(rec) for rec in records]


@app.patch("/admin/users/{user_id}/booking-access", response_model=UserProfile)
def update_booking_access(
    user_id: int,
    payload: BookingAccessUpdate,
    current_user: Dict = Depends(_get_current_user),
):
    _require_admin(current_user)
    if user_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot modify your own booking access")
    try:
        record = db.set_booking_enabled(user_id=user_id, enabled=payload.enabled)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return _serialize_user(record)


@app.patch("/admin/users/{user_id}/role", response_model=UserProfile)
def update_user_role(
    user_id: int,
    payload: UserRoleUpdate,
    current_user: Dict = Depends(_get_current_user),
):
    _require_admin(current_user)
    if user_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="Cannot modify your own role")
    try:
        record = db.set_user_role(user_id=user_id, role=payload.role)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return _serialize_user(record)


@app.get("/slots", response_model=List[ParkingSlotResponse])
def list_slots(
    zone_id: int | None = Query(default=None),
    status: str | None = Query(default=None),
    current_user: Dict = Depends(_get_current_user),
):
    _require_admin(current_user)
    records = db.list_parking_slots(zone_id=zone_id, status=status)
    return [_serialize_slot(rec) for rec in records]


@app.patch("/slots/{slot_id}", response_model=ParkingSlotResponse)
def update_slot(
    slot_id: int,
    payload: ParkingSlotUpdate,
    current_user: Dict = Depends(_get_current_user),
):
    _require_admin(current_user)
    fields = {k: v for k, v in payload.dict(exclude_unset=True).items()}
    try:
        record = db.update_parking_slot(slot_id, **fields)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _serialize_slot(record)


# Razorpay integration endpoints (test mode)
@app.post("/payments/razorpay/create-order", response_model=RazorpayOrderCreateResponse)
def create_razorpay_order(
    payload: RazorpayOrderCreateRequest,
    current_user: Dict = Depends(_get_current_user),
):
    client = _get_razorpay_client()
    amount_paise = int(payload.amount * 100)
    reservation_id = payload.reservation_id

    order_payload = {
        "amount": amount_paise,
        "currency": payload.currency,
        "payment_capture": 1,
        "receipt": payload.receipt or f"reservation_{reservation_id or current_user['id']}_{int(time.time())}",
        "notes": payload.notes or {},
    }
    try:
        order = client.order.create(order_payload)
    except Exception as exc:
        logger.exception("Failed to create Razorpay order: %s", exc)
        raise HTTPException(status_code=502, detail="Failed to create Razorpay order")

    payment_record = db.create_payment(
        amount=payload.amount,
        currency=payload.currency,
        reservation_id=reservation_id,
        provider_order_id=order["id"],
    )

    return RazorpayOrderCreateResponse(
        order_id=order["id"],
        amount=order["amount"],
        currency=order["currency"],
        key_id=RAZORPAY_KEY_ID,
        payment_id=payment_record["id"],
        reservation_id=reservation_id,
    )


@app.post("/payments/razorpay/verify", response_model=PaymentResponse)
def verify_razorpay_payment(
    payload: RazorpayVerifyRequest,
    current_user: Dict = Depends(_get_current_user),
):
    client = _get_razorpay_client()
    try:
        client.utility.verify_payment_signature(
            {
                "razorpay_order_id": payload.razorpay_order_id,
                "razorpay_payment_id": payload.razorpay_payment_id,
                "razorpay_signature": payload.razorpay_signature,
            }
        )
    except razorpay.errors.SignatureVerificationError as exc:  # type: ignore[attr-defined]
        raise HTTPException(status_code=400, detail=f"Signature verification failed: {exc}")

    payment_record = db.fetch_payment_by_order_id(payload.razorpay_order_id)
    if not payment_record:
        raise HTTPException(status_code=404, detail="Payment record not found for order")

    updated_record = db.update_payment(
        payment_id=payment_record["id"],
        status="succeeded",
        provider_ref=payload.razorpay_payment_id,
    )

    if payload.reservation_id:
        try:
            db.update_reservation_status(
                reservation_id=payload.reservation_id,
                status="confirmed",
                payment_ref=str(updated_record["id"]),
            )
        except ValueError:
            logger.warning("Reservation %s not found while linking payment", payload.reservation_id)

    db.create_notification(
        user_id=current_user["id"],
        notification_type="payment",
        title="Payment Successful",
        message=f"Your payment of ₹{updated_record['amount']} was successful.",
    )

    return _serialize_payment(updated_record)


# Utility endpoint to create notifications (for testing)
@app.post("/test/notifications", response_model=NotificationResponse, status_code=201)
def create_test_notification(
    title: str = Form(...),
    message: str = Form(...),
    notification_type: str = Form(default="info"),
    current_user: Dict = Depends(_get_current_user),
):
    """Create a test notification (for development/testing)"""
    record = db.create_notification(
        user_id=current_user["id"],
        notification_type=notification_type,
        title=title,
        message=message,
    )
    return _serialize_notification(record)
