import { useState, useEffect, useMemo } from "react";
import { useAuth } from "../context/AuthContext";
import {
  Car,
  Clock,
  MapPin,
  CreditCard,
  CheckCircle,
  ArrowRight,
  ArrowLeft,
  Lock,
  Plus,
} from "lucide-react";

export default function Booking() {
  const { user, authorizedRequest } = useAuth();
  const [currentStep, setCurrentStep] = useState(1);
  const [vehicles, setVehicles] = useState([]);
  const [selectedVehicle, setSelectedVehicle] = useState("");
  const [selectedSlot, setSelectedSlot] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedTime, setSelectedTime] = useState("");
  const [duration, setDuration] = useState(2);
  const [loading, setLoading] = useState(false);
  const [reservation, setReservation] = useState(null);
  const [payment, setPayment] = useState(null);
  const [error, setError] = useState("");
  const [razorpayReady, setRazorpayReady] = useState(false);
  const [paymentProcessing, setPaymentProcessing] = useState(false);
  const [passes, setPasses] = useState([]);
  const [passesLoading, setPassesLoading] = useState(false);

  const steps = [
    { id: 1, name: "Select Slot", icon: MapPin },
    { id: 2, name: "Choose Vehicle", icon: Car },
    { id: 3, name: "Set Timing", icon: Clock },
    { id: 4, name: "Payment", icon: CreditCard },
    { id: 5, name: "Confirmation", icon: CheckCircle },
  ];

  useEffect(() => {
    fetchVehicles();
  }, []);

  useEffect(() => {
    if (!user) return;
    const fetchPasses = async () => {
      setPassesLoading(true);
      try {
        const data = await authorizedRequest("/user/passes");
        setPasses(data || []);
      } catch (err) {
        console.error("Failed to load passes", err);
      } finally {
        setPassesLoading(false);
      }
    };
    fetchPasses();
  }, [authorizedRequest, user]);

  const selectedVehicleDetails = useMemo(
    () => vehicles.find((v) => v.id === selectedVehicle),
    [vehicles, selectedVehicle]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.Razorpay) {
      setRazorpayReady(true);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => setRazorpayReady(true);
    script.onerror = () =>
      setError("Failed to load Razorpay checkout. Please refresh and try again.");
    document.body.appendChild(script);
    return () => {
      document.body.removeChild(script);
    };
  }, []);

  const fetchVehicles = async () => {
    try {
      const data = await authorizedRequest("/user/vehicles");
      setVehicles(data || []);
    } catch (error) {
      console.error("Failed to fetch vehicles:", error);
      // Demo data for testing
      setVehicles([
        { id: 1, license_plate: "KA01 AB 1234", make: "Toyota", model: "Camry" },
        { id: 2, license_plate: "KA02 CD 5678", make: "Honda", model: "City" },
      ]);
    }
  };

  const handleNext = () => {
    if (currentStep < steps.length) {
      setCurrentStep((step) => step + 1);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleCreateReservation = async () => {
    setLoading(true);
    setError("");
    
    try {
      const startTime = new Date(`${selectedDate}T${selectedTime}`);
      const endTime = new Date(startTime.getTime() + duration * 60 * 60 * 1000);
      
      const reservationData = await authorizedRequest("/reservations", {
        method: "POST",
        body: {
          slot_id: selectedSlot,
          lot_id: "P1",
          user_ref: user.id.toString(),
          start_time: startTime.toISOString(),
          end_time: endTime.toISOString(),
        },
      });
      
      setReservation(reservationData);
      setCurrentStep(4);
    } catch (error) {
      setError(error.message || "Failed to create reservation");
    } finally {
      setLoading(false);
    }
  };

  const handlePayment = async () => {
    if (!razorpayReady) {
      setError("Razorpay checkout is not ready yet. Please wait a moment.");
      return;
    }
    if (!reservation) {
      setError("Please create a reservation before attempting payment.");
      return;
    }

    setError("");
    setPaymentProcessing(true);

    try {
      const order = await authorizedRequest("/payments/razorpay/create-order", {
        method: "POST",
        body: {
          amount: duration * 50,
          currency: "INR",
          reservation_id: reservation.id,
          notes: {
            slot_id: reservation.slot_id,
            vehicle_id: selectedVehicle,
          },
        },
      });

      const options = {
        key: order.key_id,
        amount: order.amount,
        currency: order.currency,
        name: "SmartPark",
        description: `Reservation #${reservation.id}`,
        order_id: order.order_id,
        prefill: {
          name: user?.name,
          email: user?.email,
        },
        notes: {
          reservation_id: reservation.id,
          slot_id: reservation.slot_id,
        },
        handler: async (response) => {
          try {
            const verification = await authorizedRequest("/payments/razorpay/verify", {
              method: "POST",
              body: {
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                reservation_id: reservation.id,
              },
            });
            setPayment(verification);
            setReservation((prev) =>
              prev ? { ...prev, status: "confirmed", payment_ref: verification.id } : prev
            );
            let createdPass = null;
            try {
              createdPass = await authorizedRequest("/user/passes", {
                method: "POST",
                body: {
                  reservation_id: reservation.id,
                  slot_id: reservation.slot_id,
                  lot_id: reservation.lot_id,
                  vehicle_plate: selectedVehicleDetails?.license_plate || "",
                  start_time: reservation.start_time,
                  end_time: reservation.end_time,
                  amount: verification.amount,
                  status: verification.status,
                  payment_ref: verification.provider_ref,
                },
              });
            } catch (passErr) {
              console.error("Failed to persist pass", passErr);
            }
            if (createdPass) {
              setPasses((prev) => [createdPass, ...prev]);
            }
            setCurrentStep(5);
          } catch (verifyError) {
            setError(verifyError.message || "Failed to verify payment.");
          } finally {
            setPaymentProcessing(false);
          }
        },
        modal: {
          ondismiss: () => setPaymentProcessing(false),
        },
        theme: {
          color: "#0f172a",
        },
      };

      const razorpayInstance = new window.Razorpay(options);
      razorpayInstance.on("payment.failed", (resp) => {
        setError(resp.error?.description || "Payment failed. Please try again.");
        setPaymentProcessing(false);
      });
      razorpayInstance.open();
    } catch (err) {
      setError(err.message || "Failed to initialize payment.");
      setPaymentProcessing(false);
    }
  };

  const renderPassHtml = (pass) => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>SmartPark Pass #${pass.reservation_id}</title>
    <style>
      body { font-family: Arial, sans-serif; background: #f5f5f5; padding: 32px; }
      .pass { max-width: 500px; margin: auto; background: white; border-radius: 16px; padding: 32px; box-shadow: 0 20px 50px rgba(15,23,42,0.1); }
      h1 { margin-top: 0; color: #0f172a; }
      .row { display: flex; justify-content: space-between; margin-bottom: 12px; }
      .label { color: #64748b; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.08em; }
      .value { font-weight: 600; color: #0f172a; }
      .qr { margin-top: 24px; text-align: center; }
      .footer { margin-top: 24px; font-size: 0.8rem; color: #94a3b8; text-align: center; }
    </style>
  </head>
  <body>
    <div class="pass">
      <h1>SmartPark Access Pass</h1>
      <div class="row"><span class="label">Reservation ID</span><span class="value">#${pass.reservation_id}</span></div>
      <div class="row"><span class="label">Slot</span><span class="value">${pass.slot_id} (${pass.lot_id})</span></div>
      <div class="row"><span class="label">Vehicle</span><span class="value">${pass.vehicle_plate || "—"}</span></div>
      <div class="row"><span class="label">Start</span><span class="value">${new Date(pass.start_time).toLocaleString()}</span></div>
      <div class="row"><span class="label">End</span><span class="value">${new Date(pass.end_time).toLocaleString()}</span></div>
      <div class="row"><span class="label">Payment</span><span class="value">₹${pass.amount} • ${pass.status}</span></div>
      <div class="row"><span class="label">Payment Ref</span><span class="value">${pass.payment_ref || "N/A"}</span></div>
      <div class="qr">
        <p class="label">Present this pass at entry</p>
        <p class="value">Reservation #${pass.reservation_id}</p>
      </div>
      <div class="footer">SmartPark • Generated ${new Date(pass.generated_at).toLocaleString()}</div>
    </div>
    <script>window.print && window.print();</script>
  </body>
</html>`;

  const handleDownloadPass = (passOverride) => {
    const pass =
      passOverride ||
      (reservation && payment
        ? {
            reservation_id: reservation.id,
            slot_id: reservation.slot_id,
            lot_id: reservation.lot_id,
            vehicle_plate: selectedVehicleDetails?.license_plate || "",
            start_time: reservation.start_time,
            end_time: reservation.end_time,
            amount: payment.amount,
            status: payment.status,
            payment_ref: payment.provider_ref,
            generated_at: new Date().toISOString(),
          }
        : null);
    if (!pass) return;

    const passHtml = renderPassHtml(pass);
    const blob = new Blob([passHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `smartpark-pass-${pass.reservation_id}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const bookingBlocked = user && user.booking_enabled === false;

  if (bookingBlocked) {
    return (
      <div className="min-h-screen bg-gray-50 py-12 px-4">
        <div className="max-w-3xl mx-auto text-center bg-white border border-rose-100 rounded-2xl px-8 py-12 shadow-sm">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-rose-50 text-rose-500">
            <Lock className="h-8 w-8" />
          </div>
          <h1 className="text-2xl font-semibold text-gray-900 mb-3">
            Booking access pending approval
          </h1>
          <p className="text-sm text-gray-600 leading-relaxed">
            Your account has not been cleared for self-service booking yet. Please contact an admin
            to enable access. You can still view your saved passes below.
          </p>
        </div>
        <PassesPanel
          passes={passes}
          loading={passesLoading}
          onDownload={handleDownloadPass}
          renderPassHtml={renderPassHtml}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Book Your Parking Slot</h1>
        
        {/* Progress Steps */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            {steps.map((step, index) => {
              const Icon = step.icon;
              const isActive = currentStep === step.id;
              const isCompleted = currentStep > step.id;
              
              return (
                <div key={step.id} className="flex items-center">
                  <div className={`flex items-center justify-center w-12 h-12 rounded-full border-2 ${
                    isActive
                      ? "border-blue-600 bg-blue-600 text-white"
                      : isCompleted
                      ? "border-green-600 bg-green-600 text-white"
                      : "border-gray-300 bg-white text-gray-500"
                  }`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="ml-3">
                    <p className={`text-sm font-medium ${
                      isActive ? "text-blue-600" : isCompleted ? "text-green-600" : "text-gray-500"
                    }`}>
                      {step.name}
                    </p>
                  </div>
                  {index < steps.length - 1 && (
                    <div className={`w-full h-0.5 mx-4 ${
                      isCompleted ? "bg-green-600" : "bg-gray-300"
                    }`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">
            {error}
          </div>
        )}

        {/* Step Content */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          {currentStep === 1 && <SlotSelectionStep selectedSlot={selectedSlot} setSelectedSlot={setSelectedSlot} />}
          {currentStep === 2 && <VehicleSelectionStep vehicles={vehicles} selectedVehicle={selectedVehicle} setSelectedVehicle={setSelectedVehicle} />}
          {currentStep === 3 && <TimingStep 
            selectedDate={selectedDate} 
            setSelectedDate={setSelectedDate}
            selectedTime={selectedTime}
            setSelectedTime={setSelectedTime}
            duration={duration}
            setDuration={setDuration}
          />}
          {currentStep === 4 && (
            <PaymentStep
              duration={duration}
              reservation={reservation}
              checkoutReady={razorpayReady}
              vehicle={vehicles.find((v) => v.id === selectedVehicle)}
            />
          )}
          {currentStep === 5 && (
            <ConfirmationStep
              reservation={reservation}
              payment={payment}
              onDownloadPass={() => handleDownloadPass()}
              vehiclePlate={selectedVehicleDetails?.license_plate}
            />
          )}
        </div>

        {/* Navigation */}
        <div className="flex justify-between">
          <button
            onClick={handlePrevious}
            disabled={currentStep === 1}
            className="flex items-center px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Previous
          </button>
          
          {currentStep < 4 && (
            <button
              onClick={currentStep === 3 ? handleCreateReservation : handleNext}
              disabled={
                loading ||
                (currentStep === 1 && !selectedSlot) ||
                (currentStep === 2 && !selectedVehicle) ||
                (currentStep === 3 && (!selectedDate || !selectedTime))
              }
              className="flex items-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {currentStep === 3 && loading ? "Booking..." : "Next"}
              <ArrowRight className="h-4 w-4 ml-2" />
            </button>
          )}
          
          {currentStep === 4 && (
            <button
              onClick={handlePayment}
              disabled={paymentProcessing || !razorpayReady}
              className="flex items-center px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {paymentProcessing ? "Processing..." : `Pay ₹${duration * 50}`}
            </button>
          )}
        </div>
      </div>

      <PassesPanel
        passes={passes}
        loading={passesLoading}
        onDownload={handleDownloadPass}
        renderPassHtml={renderPassHtml}
      />
    </div>
  );
}

function SlotSelectionStep({ selectedSlot, setSelectedSlot }) {
  const slots = [
    { id: "A12", level: "P2", status: "available", distance: "35m from lift" },
    { id: "B08", level: "P1", status: "available", distance: "20m from exit" },
    { id: "C21", level: "P3", status: "reserved", distance: "50m from lift" },
    { id: "D04", level: "P2", status: "available", distance: "EV fast charger" },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Choose a slot</h2>
        <p className="text-sm text-gray-600">Pick a bay that best matches your needs.</p>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {slots.map((slot) => {
          const unavailable = slot.status !== "available";
          const isSelected = selectedSlot === slot.id;
          return (
            <button
              key={slot.id}
              disabled={unavailable}
              onClick={() => setSelectedSlot(slot.id)}
              className={`w-full text-left border rounded-xl p-4 transition ${
                isSelected ? "border-blue-600 bg-blue-50" : "border-gray-200 bg-white"
              } ${unavailable ? "opacity-50 cursor-not-allowed" : "hover:border-blue-400"}`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-semibold text-gray-900">Slot {slot.id}</p>
                  <p className="text-sm text-gray-600">Level {slot.level}</p>
                </div>
                <span
                  className={`text-xs font-semibold px-3 py-1 rounded-full ${
                    unavailable ? "bg-gray-200 text-gray-600" : "bg-green-100 text-green-700"
                  }`}
                >
                  {slot.status === "available" ? "Available" : "Reserved"}
                </span>
              </div>
              <p className="text-sm text-gray-500 mt-2">{slot.distance}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function VehicleSelectionStep({ vehicles, selectedVehicle, setSelectedVehicle }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Select vehicle</h2>
        <p className="text-sm text-gray-600">
          Choose which vehicle you plan to park. Manage vehicles under Profile.
        </p>
      </div>
      {vehicles.length === 0 ? (
        <div className="p-6 border border-dashed border-gray-300 rounded-xl text-center">
          <p className="text-gray-600 mb-4">No vehicles found.</p>
          <p className="text-sm text-gray-500">Add vehicles from your profile to continue.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {vehicles.map((vehicle) => {
            const isSelected = selectedVehicle === vehicle.id;
            return (
              <button
                key={vehicle.id}
                onClick={() => setSelectedVehicle(vehicle.id)}
                className={`w-full text-left border rounded-xl p-4 transition ${
                  isSelected ? "border-blue-600 bg-blue-50" : "border-gray-200 bg-white"
                } hover:border-blue-400`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-lg font-semibold text-gray-900">{vehicle.license_plate}</p>
                    <p className="text-sm text-gray-600">
                      {[vehicle.make, vehicle.model].filter(Boolean).join(" ")}
                    </p>
                  </div>
                  {isSelected && (
                    <span className="text-xs font-semibold px-3 py-1 rounded-full bg-blue-100 text-blue-700">
                      Selected
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TimingStep({
  selectedDate,
  setSelectedDate,
  selectedTime,
  setSelectedTime,
  duration,
  setDuration,
}) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Schedule your stay</h2>
        <p className="text-sm text-gray-600">
          Pick a date, start time and duration for your reservation.
        </p>
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <label className="text-sm font-medium text-gray-700 mb-2 block">Date</label>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500"
            min={new Date().toISOString().split("T")[0]}
            max={new Date(tomorrow).toISOString().split("T")[0]}
          />
        </div>
        <div>
          <label className="text-sm font-medium text-gray-700 mb-2 block">Start time</label>
          <input
            type="time"
            value={selectedTime}
            onChange={(e) => setSelectedTime(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500"
            step={900}
          />
        </div>
      </div>
      <div>
        <label className="text-sm font-medium text-gray-700 mb-2 block">
          Duration (hours)
        </label>
        <input
          type="range"
          min="1"
          max="8"
          value={duration}
          onChange={(e) => setDuration(Number(e.target.value))}
          className="w-full"
        />
        <p className="text-sm text-gray-600 mt-2">{duration} hours • ₹{duration * 50}</p>
      </div>
    </div>
  );
}

function PaymentStep({ duration }) {
  const summary = [
    { label: "Hourly rate", value: "₹50" },
    { label: "Duration", value: `${duration} hours` },
    { label: "Subtotal", value: `₹${duration * 50}` },
    { label: "Taxes", value: "₹0 (test mode)" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Payment summary</h2>
        <p className="text-sm text-gray-600">
          Complete the payment to confirm your reservation. Razorpay test mode is active.
        </p>
      </div>
      <div className="space-y-3">
        {summary.map((item) => (
          <div
            key={item.label}
            className="flex items-center justify-between border border-gray-200 rounded-lg px-4 py-3"
          >
            <p className="text-sm text-gray-600">{item.label}</p>
            <p className="font-semibold text-gray-900">{item.value}</p>
          </div>
        ))}
      </div>
      <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-sm text-blue-700">
        Mock Razorpay integration is wired. Any payment attempt will be treated as successful.
      </div>
    </div>
  );
}

function ConfirmationStep({ reservation, payment, onDownloadPass }) {
  if (!reservation || !payment) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Awaiting reservation and payment details…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-center">
      <CheckCircle className="h-16 w-16 text-green-500 mx-auto" />
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Booking confirmed!</h2>
        <p className="text-sm text-gray-600 mt-2">
          Reservation #{reservation.id} • Payment #{payment.id}
        </p>
      </div>
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 text-left space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Slot</span>
          <span className="font-semibold text-gray-900">{reservation.slot_id}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Lot</span>
          <span className="font-semibold text-gray-900">{reservation.lot_id}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Start</span>
          <span className="font-semibold text-gray-900">
            {new Date(reservation.start_time).toLocaleString()}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">End</span>
          <span className="font-semibold text-gray-900">
            {new Date(reservation.end_time).toLocaleString()}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Payment Status</span>
          <span className="font-semibold text-green-600 capitalize">{payment.status}</span>
        </div>
      </div>
      <button
        onClick={onDownloadPass}
        className="px-6 py-3 bg-gray-900 text-white rounded-lg hover:bg-black transition"
      >
        Download Pass
      </button>
    </div>
  );
}

function PassesPanel({ passes, loading, onDownload, renderPassHtml }) {
  return (
    <div className="max-w-4xl mx-auto mt-12">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Saved Passes</h2>
          <p className="text-sm text-gray-500">
            Your recent passes stay here so you can re-open or download them anytime.
          </p>
        </div>
        {loading && <span className="text-sm text-gray-500">Refreshing…</span>}
      </div>

      {!loading && passes.length === 0 ? (
        <div className="border border-dashed border-gray-300 rounded-xl p-6 text-center text-gray-500">
          No passes yet. Complete a booking to see it listed here.
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {passes.map((passRecord) => (
            <div
              key={`${passRecord.reservation_id}-${passRecord.generated_at}`}
              className="bg-white rounded-xl border border-gray-200 p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <p className="font-semibold text-gray-900">Reservation #{passRecord.reservation_id}</p>
                <span className="text-xs uppercase tracking-wide font-semibold text-emerald-600">
                  {passRecord.status}
                </span>
              </div>
              <p className="text-sm text-gray-600">
                Slot {passRecord.slot_id} • {passRecord.lot_id}
              </p>
              <p className="text-sm text-gray-600">
                Vehicle: {passRecord.vehicle_plate || "—"}
              </p>
              <p className="text-xs text-gray-500">
                {new Date(passRecord.start_time).toLocaleString()} →{" "}
                {new Date(passRecord.end_time).toLocaleString()}
              </p>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => onDownload(passRecord)}
                  className="px-3 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-black transition"
                >
                  Download
                </button>
                <button
                  onClick={() =>
                    window.open(
                      `data:text/html,${encodeURIComponent(renderPassHtml(passRecord))}`,
                      "_blank"
                    )
                  }
                  className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                >
                  View
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
