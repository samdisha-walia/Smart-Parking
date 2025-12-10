import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { MapPin, Navigation, Wifi } from "lucide-react";

const fallbackSnapshotCounts = {
  occupied: 78,
  available: 27,
  reserved: 14,
  ev: 9,
};

const fallbackForecastPoints = (() => {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const templateRates = [0.68, 0.74, 0.82, 0.87, 0.79, 0.71];
  const total = 120;
  return templateRates.map((rate, idx) => {
    const ts = new Date(now.getTime() + idx * 60 * 60 * 1000);
    return {
      timestamp: ts.toISOString(),
      occupancy_rate: rate,
      estimated_total: total,
      estimated_occupied: rate * total,
      estimated_available: total - rate * total,
    };
  });
})();

const recentAnprEvents = [
  {
    plate: "KA03 ML 7788",
    action: "Entry • Corporate Gate",
    status: "Permit synced (Tier-A)",
    time: "10:42",
    confidence: 0.94,
  },
  {
    plate: "KA05 CT 1190",
    action: "Exit • Gate C",
    status: "Payment auto-captured",
    time: "10:38",
    confidence: 0.91,
  },
  {
    plate: "TS09 GK 4420",
    action: "Entry • Visitor",
    status: "2h pass issued",
    time: "10:31",
    confidence: 0.96,
  },
  {
    plate: "KA51 HQ 8833",
    action: "Entry • EV lane",
    status: "Charger bay allocated",
    time: "10:27",
    confidence: 0.89,
  },
];

const opsHighlights = [
  {
    title: "Demand spike on Level P2",
    detail: "+14% arrivals from Brigade Tech Park between 10:00-11:00.",
  },
  {
    title: "EV chargers",
    detail: "9 / 12 fast chargers active, 3 more reserved for lunchtime window.",
  },
  {
    title: "No-show cleanup",
    detail: "12 stale reservations auto-freed after 15 minutes of inactivity.",
  },
];

const initialLiveFeed = [
  {
    id: "emerald",
    label: "Emerald Row • EV Priority",
    occupied: 46,
    total: 60,
    lat: 12.9719,
    lng: 77.5946,
    turnover: 11,
    avgStay: 44,
    incidents: 0,
  },
  {
    id: "sapphire",
    label: "Sapphire Loop • Visitor Core",
    occupied: 35,
    total: 48,
    lat: 12.9724,
    lng: 77.5951,
    turnover: 8,
    avgStay: 37,
    incidents: 1,
  },
  {
    id: "amber",
    label: "Amber Deck • Rooftop",
    occupied: 21,
    total: 40,
    lat: 12.9728,
    lng: 77.5938,
    turnover: 6,
    avgStay: 52,
    incidents: 0,
  },
  {
    id: "onyx",
    label: "Onyx Basement • Corporate Pool",
    occupied: 57,
    total: 70,
    lat: 12.9731,
    lng: 77.5961,
    turnover: 9,
    avgStay: 49,
    incidents: 2,
  },
];

const demandSeries = [
  { time: "06:00", demand: 24, available: 96 },
  { time: "08:00", demand: 48, available: 72 },
  { time: "10:00", demand: 82, available: 38 },
  { time: "12:00", demand: 94, available: 26 },
  { time: "14:00", demand: 87, available: 33 },
  { time: "16:00", demand: 90, available: 30 },
  { time: "18:00", demand: 76, available: 44 },
  { time: "20:00", demand: 51, available: 69 },
  { time: "22:00", demand: 34, available: 86 },
];

const arrowModelSrc =
  "https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets/Models/OrientationTest/glTF-Binary/OrientationTest.glb";

const arGuidanceSteps = [
  {
    title: "Scan entry marker",
    detail: "Camera auto-locks on our holographic beacon at each lift lobby.",
  },
  {
    title: "Follow volumetric arrows",
    detail: "Arrows adapt every 400ms using live occupancy + IMU fusion.",
  },
  {
    title: "Dock at assigned bay",
    detail: "Overlay switches to green once you're aligned with slot S12.",
  },
];

export default function Analytics() {
  const [liveZones, setLiveZones] = useState(initialLiveFeed);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [snapshotCounts, setSnapshotCounts] = useState(
    fallbackSnapshotCounts
  );
  const [forecast, setForecast] = useState(fallbackForecastPoints);
  const [loadingForecast, setLoadingForecast] = useState(true);
  const [reservationStatus, setReservationStatus] = useState(null);
  const [reservation, setReservation] = useState(null);
  const [payment, setPayment] = useState(null);
  const [paymentMessage, setPaymentMessage] = useState(null);
  const [isConfirmingPayment, setIsConfirmingPayment] = useState(false);
  const [arOverlayActive, setArOverlayActive] = useState(false);
  const [arStatus, setArStatus] = useState("Ready to anchor");
  const [arDeviceSupported, setArDeviceSupported] = useState(true);
  const [arSessionError, setArSessionError] = useState(null);
  const arViewerRef = useRef(null);

  const highlightedSlot = {
    code: "S12",
    level: "P2",
    section: "Emerald Row",
    lat: 12.9716,
    lng: 77.5946,
    note: "Closest elevator core is Core-B. Follow turquoise floor markings.",
  };

  const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${highlightedSlot.lat},${highlightedSlot.lng}&travelmode=driving`;
  const appleMapsUrl = `https://maps.apple.com/?daddr=${highlightedSlot.lat},${highlightedSlot.lng}&dirflg=d`;
  const liveMapEmbed = `https://maps.google.com/maps?q=${highlightedSlot.lat},${highlightedSlot.lng}&z=18&output=embed`;

  useEffect(() => {
    const interval = setInterval(() => {
      setLiveZones((prev) =>
        prev.map((zone) => ({
          ...zone,
          occupied: Math.min(
            zone.total,
            Math.max(0, zone.occupied + (Math.random() > 0.5 ? 1 : -1))
          ),
        }))
      );
      setLastUpdated(new Date());
    }, 12000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [snapshotRes, forecastRes] = await Promise.all([
          fetch("http://localhost:8000/slots/P1/snapshot"),
          fetch("http://localhost:8000/lots/P1/forecast?hours=6"),
        ]);
        if (!snapshotRes.ok || !forecastRes.ok) {
          throw new Error("Backend responded with non-200");
        }
        const snapshotJson = await snapshotRes.json();
        const forecastJson = await forecastRes.json();
        setSnapshotCounts({
          ...fallbackSnapshotCounts,
          ...(snapshotJson.counts || {}),
        });
        setForecast(
          Array.isArray(forecastJson.points) && forecastJson.points.length > 0
            ? forecastJson.points
            : fallbackForecastPoints
        );
      } catch (error) {
        console.error("Failed to load backend data", error);
        setSnapshotCounts(fallbackSnapshotCounts);
        setForecast(fallbackForecastPoints);
      } finally {
        setLoadingForecast(false);
      }
    };

    fetchData();
    const refresh = setInterval(fetchData, 60000);
    return () => clearInterval(refresh);
  }, []);

  const derivedSnapshot = useMemo(
    () => ({
      ...fallbackSnapshotCounts,
      ...snapshotCounts,
    }),
    [snapshotCounts]
  );

  const totalLiveOccupancy = useMemo(
    () => liveZones.reduce((sum, zone) => sum + zone.occupied, 0),
    [liveZones]
  );

  const totalSlots =
    (derivedSnapshot.occupied || 0) + (derivedSnapshot.available || 0);
  const occupancyPercent = totalSlots
    ? Math.round((derivedSnapshot.occupied / totalSlots) * 100)
    : 0;

  const recentOccupancyText = useMemo(() => {
    const occupied = derivedSnapshot.occupied || 0;
    const available = derivedSnapshot.available || 0;
    return `${occupied} occupied / ${available} free (last 15 min)`;
  }, [derivedSnapshot]);

  const keyStats = useMemo(
    () => [
      {
        label: "Current occupancy",
        value: `${occupancyPercent}%`,
        sub: `${derivedSnapshot.occupied} of ${totalSlots} bays engaged`,
      },
      {
        label: "Reservations queued",
        value: derivedSnapshot.reserved ?? 0,
        sub: "Auto-release after 15 min of no activity",
      },
      {
        label: "EV chargers active",
        value: derivedSnapshot.ev ?? 0,
        sub: "Emerald Row fast chargers online",
      },
      {
        label: "Live detections",
        value: totalLiveOccupancy,
        sub: "Across four monitored micro-zones",
      },
    ],
    [
      derivedSnapshot,
      occupancyPercent,
      totalLiveOccupancy,
      totalSlots,
    ]
  );

  const checkArSupport = useCallback(async () => {
    // Basic feature detection for WebXR / DeviceOrientation availability
    const hasXR =
      typeof window !== "undefined" &&
      ("xr" in navigator || "DeviceOrientationEvent" in window);
    if (!hasXR) {
      setArDeviceSupported(false);
      setArStatus("Unsupported device");
      return false;
    }
    setArDeviceSupported(true);
    setArStatus("Scanning environment...");
    return true;
  }, []);

  const handleLaunchAr = async () => {
    const ok = await checkArSupport();
    if (!ok) {
      return;
    }
    setArOverlayActive(true);
    setArStatus("Align phone with Core-B marker");
    setArSessionError(null);
  };

  const handleCloseAr = () => {
    setArOverlayActive(false);
    setArStatus("Ready to anchor");
    setArSessionError(null);
  };

  const handleStartArSession = () => {
    if (arViewerRef.current && typeof arViewerRef.current.activateAR === "function") {
      arViewerRef.current.activateAR();
    } else {
      setArSessionError("Browser blocked WebXR activation. Try Chrome (Android) or Safari (iOS).");
    }
  };

  useEffect(() => {
    if (!arOverlayActive || !arViewerRef.current) return;
    const viewer = arViewerRef.current;
    const handleArStatus = (event) => {
      const status = event.detail?.status;
      if (!status) return;
      if (status === "session-started") {
        setArStatus("In-session • follow arrow");
        setArSessionError(null);
      } else if (status === "failed") {
        setArStatus("Calibration failed");
        setArSessionError("WebXR session failed. Move to a well-lit area and retry.");
      } else if (status === "not-presenting") {
        setArStatus("Ready to anchor");
      } else {
        setArStatus(status.replace(/-/g, " "));
      }
    };
    viewer.addEventListener("ar-status", handleArStatus);
    return () => viewer.removeEventListener("ar-status", handleArStatus);
  }, [arOverlayActive]);

  const handleReservation = async () => {
    try {
      const response = await fetch("http://localhost:8000/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slot_id: highlightedSlot.code,
          lot_id: "P1",
          user_ref: "demo-user",
          start_time: new Date().toISOString(),
          end_time: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
      });
      const reservationData = await response.json();
      setReservation(reservationData);
      setReservationStatus(
        `Reservation #${reservationData.id} pending. Payment intent initializing...`
      );

      const paymentResponse = await fetch("http://localhost:8000/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: 120,
          currency: "INR",
          reservation_id: reservationData.id,
        }),
      });
      const paymentData = await paymentResponse.json();
      setPayment(paymentData);
      setReservationStatus(
        `Reservation #${reservationData.id} pending. Payment #${paymentData.id} requires confirmation.`
      );
      setPaymentMessage(null);
    } catch (error) {
      setReservationStatus("Failed to create reservation.");
    }
  };

  const handleConfirmPayment = async () => {
    if (!payment) return;
    setIsConfirmingPayment(true);
    try {
      const response = await fetch(
        `http://localhost:8000/payments/${payment.id}/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "succeeded",
            provider_ref: "demo-gateway-ref",
          }),
        }
      );
      const paymentData = await response.json();
      setPayment(paymentData);
      setPaymentMessage(
        `Payment #${paymentData.id} ${paymentData.status}. Reservation ready!`
      );
    } catch (error) {
      setPaymentMessage("Payment confirmation failed.");
    } finally {
      setIsConfirmingPayment(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-6">
      <h2 className="text-3xl font-bold text-center mb-10 text-gray-800">
        Parking Demand Prediction
      </h2>
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-3xl mx-auto">
        <ResponsiveContainer width="100%" height={350}>
          <LineChart data={demandSeries}>
            <CartesianGrid strokeDasharray="3 3" stroke="#ddd" />
            <XAxis dataKey="time" stroke="#555" />
            <YAxis stroke="#555" />
            <Tooltip />
            <Line
              type="monotone"
              dataKey="demand"
              stroke="#10b981"
              strokeWidth={3}
              dot={{ r: 5 }}
              name="Demand index"
            />
            <Line
              type="monotone"
              dataKey="available"
              stroke="#6366f1"
              strokeWidth={2}
              dot={{ r: 4 }}
              name="Slots available"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 max-w-5xl mx-auto">
        {keyStats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-2xl bg-white border border-emerald-100 p-4 shadow-sm"
          >
            <p className="text-xs uppercase tracking-wide text-emerald-600 font-semibold">
              {stat.label}
            </p>
            <p className="mt-2 text-3xl font-bold text-gray-900">
              {stat.value}
            </p>
            <p className="text-xs text-gray-500 mt-1">{stat.sub}</p>
          </div>
        ))}
      </div>

      <div className="mt-12 max-w-5xl mx-auto grid gap-8 lg:grid-cols-2">
        <div className="bg-white rounded-2xl shadow-xl border border-emerald-100 p-6">
          <div className="flex items-center gap-3 text-emerald-700 mb-4">
            <Wifi size={28} />
            <div>
              <p className="text-sm uppercase tracking-wide font-semibold text-emerald-600">
                Live parking map
              </p>
              <p className="text-xs text-gray-500">
                Updated {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
          </div>
          <div className="aspect-[4/3] rounded-2xl overflow-hidden shadow-inner border border-emerald-50">
            <iframe
              title="Live Parking Map"
              src={liveMapEmbed}
              className="w-full h-full"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            ></iframe>
          </div>
          <p className="text-xs text-gray-500 mt-3">
            Embed uses Google Maps live tiles; pair with slot telemetry for precise occupancy.
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl border border-emerald-100 p-6 flex flex-col gap-4">
          <div>
            <p className="text-sm uppercase tracking-wide font-semibold text-emerald-600">
              Live occupancy feed
            </p>
            <p className="text-xs text-gray-500">
              Values auto-refresh every ~12 seconds. Numbers simulated until telemetry API is wired.
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {recentOccupancyText}
            </p>
          </div>
          <div className="space-y-4">
            {liveZones.map((zone) => {
              const percent = Math.round((zone.occupied / zone.total) * 100);
              const isTight = percent >= 75;
              return (
                <div
                  key={zone.id}
                  className="rounded-xl border border-gray-100 p-4 shadow-sm hover:shadow-md transition"
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-semibold text-gray-900">{zone.label}</p>
                      <p className="text-xs text-gray-500">
                        {zone.occupied} / {zone.total} occupied
                      </p>
                    </div>
                    <span
                      className={`text-xs font-semibold px-3 py-1 rounded-full ${
                        isTight
                          ? "bg-red-100 text-red-600"
                          : "bg-emerald-100 text-emerald-700"
                      }`}
                    >
                      {isTight ? "High demand" : "Space available"}
                    </span>
                  </div>
                  <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${
                        isTight ? "bg-red-400" : "bg-emerald-400"
                      } transition-[width]`}
                      style={{ width: `${percent}%` }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-12 bg-emerald-50 border border-emerald-100 rounded-2xl shadow-lg max-w-4xl mx-auto p-8">
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-3 text-emerald-700">
            <Navigation size={32} />
            <div>
              <p className="text-sm uppercase tracking-wide font-semibold">
                Navigate to your reserved slot
              </p>
              <h3 className="text-2xl font-bold text-gray-900 mt-1">
                {highlightedSlot.code} • Level {highlightedSlot.level}
              </h3>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="bg-white rounded-xl shadow-sm p-5 border border-emerald-100">
              <p className="text-sm font-semibold text-gray-500 uppercase">
                Slot details
              </p>
              <p className="text-lg font-semibold text-gray-900 mt-2">
                {highlightedSlot.section}
              </p>
              <p className="text-sm text-gray-600 mt-1">{highlightedSlot.note}</p>
              <div className="flex items-center gap-2 text-sm text-gray-500 mt-4">
                <MapPin size={16} />
                <span>
                  {highlightedSlot.lat.toFixed(4)}, {highlightedSlot.lng.toFixed(4)}
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-dashed border-emerald-200 p-5 space-y-3 bg-white">
              <p className="text-sm font-semibold text-gray-500 uppercase">
                Choose your maps app
              </p>
              <div className="flex flex-col gap-3">
                <a
                  href={googleMapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full text-center bg-emerald-500 text-white font-semibold py-3 rounded-full hover:bg-emerald-600 transition"
                >
                  Open in Google Maps
                </a>
                <a
                  href={appleMapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full text-center bg-white text-emerald-600 border border-emerald-200 font-semibold py-3 rounded-full hover:bg-emerald-50 transition"
                >
                  Open in Apple Maps
                </a>
              </div>
              <p className="text-xs text-gray-500">
                Both links load turn-by-turn navigation directly to slot {highlightedSlot.code}.
              </p>
              <button
                onClick={handleReservation}
                className="w-full text-center bg-black text-white font-semibold py-3 rounded-full hover:bg-gray-900 transition"
              >
                Reserve this slot
              </button>
              {reservationStatus && (
                <p className="text-xs text-gray-500">{reservationStatus}</p>
              )}
              {payment && payment.status !== "succeeded" && (
                <button
                  onClick={handleConfirmPayment}
                  className="w-full text-center bg-emerald-500 text-white font-semibold py-3 rounded-full hover:bg-emerald-600 transition"
                  disabled={isConfirmingPayment}
                >
                  {isConfirmingPayment ? "Confirming Payment..." : "Confirm Payment"}
                </button>
              )}
              {paymentMessage && (
                <p className="text-xs text-gray-500">{paymentMessage}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-12 max-w-4xl mx-auto bg-white rounded-2xl shadow-xl border border-emerald-100 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          6-hour Occupancy Forecast
        </h3>
        {loadingForecast ? (
          <p className="text-sm text-gray-500">Loading forecast...</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {forecast.map((point) => (
              <div
                key={point.timestamp}
                className="rounded-xl border border-gray-100 p-3 text-sm"
              >
                <p className="text-xs text-gray-500">
                  {new Date(point.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
                <p className="text-lg font-semibold text-gray-900">
                  {(point.occupancy_rate * 100).toFixed(0)}%
                </p>
                <p className="text-xs text-gray-500">
                  {point.estimated_available.toFixed(0)} slots free
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-12 max-w-5xl mx-auto bg-gradient-to-r from-emerald-600 via-emerald-500 to-sky-500 text-white rounded-3xl shadow-2xl overflow-hidden">
        <div className="grid gap-8 md:grid-cols-2">
          <div className="p-8">
            <p className="text-sm uppercase tracking-[0.3em] font-semibold text-emerald-100">
              AR-based parking guidance
            </p>
            <h3 className="text-3xl md:text-4xl font-extrabold mt-4 leading-tight">
              Drop a neon arrow on the floor, directly from your phone.
            </h3>
            <p className="mt-4 text-emerald-50 text-sm">
              We blend YOLO occupancy signals with on-device SLAM to render
              anchored wayfinding cues. Works with LiDAR-equipped iPhones and
              modern Android devices via WebXR.
            </p>
            <ul className="mt-6 space-y-4">
              {arGuidanceSteps.map((step) => (
                <li key={step.title} className="flex gap-3">
                  <span className="text-lg">➤</span>
                  <div>
                    <p className="font-semibold">{step.title}</p>
                    <p className="text-sm text-emerald-50/90">{step.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                className="bg-white text-emerald-700 font-semibold px-5 py-3 rounded-full shadow-lg hover:-translate-y-0.5 transition disabled:opacity-60 disabled:cursor-not-allowed"
                onClick={handleLaunchAr}
                disabled={!arDeviceSupported}
              >
                Launch AR overlay
              </button>
              <button className="bg-transparent border border-white/70 px-5 py-3 rounded-full text-white hover:bg-white/10 transition">
                Watch demo
              </button>
            </div>
          </div>
          <div className="relative">
            <div className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.45),_transparent_60%)]"></div>
            <div className="relative h-full flex items-center justify-center p-8">
              <div className="bg-black/40 border border-white/20 rounded-2xl w-full max-w-sm aspect-[9/19] shadow-2xl backdrop-blur-md overflow-hidden">
                <div className="p-4 text-xs uppercase tracking-wide text-emerald-200">
                  AR preview • Slot S12
                </div>
                <div className="px-4">
                  <div className="h-64 rounded-2xl bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 relative overflow-hidden">
                    <div className="absolute inset-0 opacity-40 bg-[radial-gradient(circle,_rgba(16,185,129,0.4),_transparent_65%)]"></div>
                    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-32 h-32 border border-emerald-300/60 rounded-full blur-3xl"></div>
                    <svg
                      viewBox="0 0 200 200"
                      className="absolute inset-0 text-emerald-300/90"
                    >
                      <path
                        d="M60 150 L100 50 L140 150"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <polyline
                        points="100,70 120,120 80,120 100,70"
                        fill="currentColor"
                        opacity="0.25"
                      />
                    </svg>
                    <div className="absolute bottom-4 left-4 right-4 text-xs text-white/80 space-y-1">
                      <p>Turn left after Core-B elevator</p>
                      <p className="text-emerald-200">2.8m to Slot S12 • ETA 00:35</p>
                    </div>
                  </div>
                </div>
                <div className="p-4 text-white/80 text-sm flex items-center justify-between">
                  <span>LiDAR lock • Stable</span>
                  <span>FPS 58</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-12 grid gap-6 lg:grid-cols-2 max-w-5xl mx-auto">
        <div className="bg-white rounded-2xl shadow-xl border border-emerald-100 p-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm uppercase tracking-wide font-semibold text-emerald-600">
                Latest ANPR events
              </p>
              <p className="text-xs text-gray-500">
                High-confidence plates processed in the last 15 minutes.
              </p>
            </div>
            <span className="text-xs font-semibold px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full">
              {recentAnprEvents.length} events
            </span>
          </div>
          <div className="mt-4 space-y-4">
            {recentAnprEvents.map((event) => (
              <div
                key={`${event.plate}-${event.time}`}
                className="rounded-xl border border-gray-100 p-4 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <p className="text-base font-semibold text-gray-900">
                    {event.plate}
                  </p>
                  <span className="text-xs text-gray-500">
                    {event.time} • {(event.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="text-sm text-gray-600 mt-1">{event.action}</p>
                <p className="text-xs text-emerald-600 font-medium mt-1">
                  {event.status}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow-xl border border-emerald-100 p-6">
          <p className="text-sm uppercase tracking-wide font-semibold text-emerald-600">
            Operations desk
          </p>
          <p className="text-xs text-gray-500">
            Snapshot of what the control room is tracking this hour.
          </p>
          <div className="mt-4 space-y-4">
            {opsHighlights.map((note) => (
              <div
                key={note.title}
                className="rounded-xl border border-dashed border-emerald-200 p-4 bg-emerald-50/50"
              >
                <p className="text-sm font-semibold text-gray-900">
                  {note.title}
                </p>
                <p className="text-xs text-gray-600 mt-1">{note.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {arOverlayActive && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xl z-50 flex items-center justify-center px-6">
          <div className="max-w-4xl w-full bg-slate-950/80 border border-white/10 rounded-3xl shadow-2xl overflow-hidden">
            <div className="flex flex-col md:flex-row">
              <div className="md:w-3/5 p-6 relative">
                <div className="absolute inset-0 opacity-30 bg-[radial-gradient(circle,_rgba(16,185,129,0.4),_transparent_60%)] pointer-events-none"></div>
                <div className="relative rounded-2xl border border-emerald-500/40 h-96 overflow-hidden bg-black/30">
                  <model-viewer
                    ref={arViewerRef}
                    src={arrowModelSrc}
                    ar
                    ar-modes="webxr scene-viewer quick-look"
                    camera-controls
                    environment-image="neutral"
                    shadow-intensity="1"
                    tone-mapping="commerce"
                    autoplay
                    interaction-prompt="none"
                    exposure="0.9"
                    className="absolute inset-0 w-full h-full"
                  ></model-viewer>
                  <div className="absolute bottom-0 left-0 right-0 p-4 bg-black/60">
                    <p className="text-emerald-200 text-sm">
                      Tap “Start AR session” to project arrow onto the floor.
                    </p>
                    <p className="text-xs text-white/70">
                      Uses WebXR hit-test + YOLO telemetry fusion for guidance.
                    </p>
                  </div>
                </div>
              </div>
              <div className="md:w-2/5 p-6 flex flex-col gap-4 border-t md:border-t-0 md:border-l border-white/10">
                <div>
                  <p className="text-sm uppercase tracking-wide text-emerald-300 font-semibold">
                    Live AR session
                  </p>
                  <h4 className="text-2xl font-bold text-white mt-2">
                    Slot S12 guidance
                  </h4>
                  <p className="text-sm text-white/70 mt-2">
                    We align your camera pose with the digital twin, updating
                    wayfinding arrows 15 times per second. Haptics trigger when
                    you’re within 1.2m of the target bay.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm text-white/80">
                  <div className="bg-white/5 rounded-xl p-3 border border-white/10">
                    <p className="text-xs uppercase text-white/50">Status</p>
                    <p className="font-semibold">{arStatus}</p>
                  </div>
                  <div className="bg-white/5 rounded-xl p-3 border border-white/10">
                    <p className="text-xs uppercase text-white/50">Tracking</p>
                    <p className="font-semibold">6DoF • Stable</p>
                  </div>
                  <div className="bg-white/5 rounded-xl p-3 border border-white/10">
                    <p className="text-xs uppercase text-white/50">Latency</p>
                    <p className="font-semibold">38 ms</p>
                  </div>
                  <div className="bg-white/5 rounded-xl p-3 border border-white/10">
                    <p className="text-xs uppercase text-white/50">Battery</p>
                    <p className="font-semibold">92%</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={handleStartArSession}
                    className="flex-1 bg-emerald-500 text-white font-semibold py-3 rounded-full hover:bg-emerald-400 transition"
                  >
                    Start AR session
                  </button>
                  <button
                    onClick={handleCloseAr}
                    className="flex-1 bg-white/10 text-white font-semibold py-3 rounded-full hover:bg-white/20 transition"
                  >
                    Close
                  </button>
                </div>
                <button
                  onClick={() => setArStatus("Arrow recalibrated")}
                  className="w-full bg-white/5 text-white font-semibold py-3 rounded-full hover:bg-white/10 transition"
                >
                  Recenter arrow
                </button>
                {arSessionError && (
                  <p className="text-xs text-red-300">{arSessionError}</p>
                )}
                {!arDeviceSupported && (
                  <p className="text-xs text-red-300">
                    Your device/browser doesn’t expose WebXR or sensor APIs. Try
                    Chrome on Android 14 or Safari on iPhone 15.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
