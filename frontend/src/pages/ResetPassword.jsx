import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { request } from "../lib/api";

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const token = searchParams.get("token");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!token) {
      setError("Reset token missing.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    setStatus(null);
    setError(null);
    try {
      const res = await request("/auth/reset-password", {
        method: "POST",
        body: { token, new_password: password },
      });
      setStatus(res.message);
      setTimeout(() => navigate("/login"), 2500);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 space-y-6">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-emerald-500">Secure reset</p>
          <h1 className="text-2xl font-extrabold text-gray-900 mt-2">Set a new password</h1>
          <p className="text-sm text-gray-500 mt-1">Choose a strong password to protect your SmartPark account.</p>
        </div>
        {!token && (
          <p className="text-sm text-red-500">Reset token missing or invalid. Request a new link.</p>
        )}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="text-xs uppercase text-gray-500">New password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="mt-1 w-full border border-gray-200 rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500"
            />
            <p className="text-xs text-gray-400 mt-1">Minimum 8 characters, mixed case, include a number.</p>
          </div>
          <div>
            <label className="text-xs uppercase text-gray-500">Confirm password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              className="mt-1 w-full border border-gray-200 rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          {status && <p className="text-sm text-emerald-600">{status}</p>}
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            className="w-full bg-emerald-500 text-white font-semibold py-3 rounded-full hover:bg-emerald-400 transition disabled:opacity-60"
            disabled={loading || !token}
          >
            {loading ? "Updating password..." : "Update password"}
          </button>
        </form>
        <p className="text-sm text-gray-500">
          <Link to="/login" className="text-emerald-600 hover:underline font-semibold">
            Back to login
          </Link>
        </p>
      </div>
    </div>
  );
}
