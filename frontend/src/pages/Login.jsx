import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const MODES = [
  { key: "user", label: "User login", description: "Access bookings, passes, and profile." },
  {
    key: "admin",
    label: "Admin login",
    description: "Restricted control tower. Admin approval required.",
  },
];

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState("user");
  const { login, logout, loading, error, setError } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || "/dashboard";

  const handleModeChange = (nextMode) => {
    setMode(nextMode);
    setError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const user = await login(email.trim(), password);
      if (mode === "admin" && user.role !== "admin") {
        await logout();
        setError("Admin access pending approval. Please use user login until promoted.");
        return;
      }
      const redirectPath =
        mode === "admin"
          ? "/admin"
          : user.role === "admin"
            ? "/analytics"
            : from;
      navigate(redirectPath, { replace: true });
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 space-y-6">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-emerald-500">Access Control</p>
          <h1 className="text-2xl font-extrabold text-gray-900 mt-2">Sign in to SmartPark</h1>
          <p className="text-sm text-gray-500 mt-1">
            Use your SmartPark credentials to access analytics, reservations, and admin tooling.
          </p>
        </div>
        <div className="flex gap-2 bg-gray-100 rounded-2xl p-1">
          {MODES.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => handleModeChange(option.key)}
              className={`flex-1 rounded-2xl px-3 py-2 text-sm font-semibold transition ${
                mode === option.key
                  ? "bg-emerald-500 text-white shadow"
                  : "text-gray-500 hover:text-gray-800"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500">
          {mode === "admin"
            ? "Only approved admins can access the control tower. Admins can still log in as users using the standard option."
            : "Standard SmartPark access for every registered user (admins included)."}
        </p>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="text-xs uppercase text-gray-500">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="mt-1 w-full border border-gray-200 rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div>
            <label className="text-xs uppercase text-gray-500">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="mt-1 w-full border border-gray-200 rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            className="w-full bg-emerald-500 text-white font-semibold py-3 rounded-full hover:bg-emerald-400 transition disabled:opacity-60"
            disabled={loading}
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <div className="text-sm text-gray-500 flex flex-col gap-2">
          <Link to="/forgot-password" className="text-emerald-600 hover:underline">
            Forgot password?
          </Link>
          <p>
            Need an account?{" "}
            <Link to="/register" className="text-emerald-600 hover:underline font-semibold">
              Register
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
