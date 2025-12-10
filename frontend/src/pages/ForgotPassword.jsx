import { useState } from "react";
import { Link } from "react-router-dom";
import { request } from "../lib/api";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setStatus(null);
    setError(null);
    try {
      const res = await request("/auth/forgot-password", {
        method: "POST",
        body: { email: email.trim() },
      });
      setStatus(res.message);
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
          <p className="text-xs uppercase tracking-[0.3em] text-emerald-500">Reset access</p>
          <h1 className="text-2xl font-extrabold text-gray-900 mt-2">Forgot your password?</h1>
          <p className="text-sm text-gray-500 mt-1">
            Enter the email linked to your SmartPark account. We will email you a secure reset link.
          </p>
        </div>
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
          {status && <p className="text-sm text-emerald-600">{status}</p>}
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            className="w-full bg-emerald-500 text-white font-semibold py-3 rounded-full hover:bg-emerald-400 transition disabled:opacity-60"
            disabled={loading}
          >
            {loading ? "Sending link..." : "Send reset link"}
          </button>
        </form>
        <p className="text-sm text-gray-500">
          Remembered your password?{" "}
          <Link to="/login" className="text-emerald-600 hover:underline font-semibold">
            Back to login
          </Link>
        </p>
      </div>
    </div>
  );
}
