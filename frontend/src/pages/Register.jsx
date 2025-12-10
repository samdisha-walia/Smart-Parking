import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Register() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [localError, setLocalError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const { register: registerUser, error, setError } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError(null);
    setError(null);

    if (!name.trim() || !email.trim() || !password.trim()) {
      setLocalError("All fields are required.");
      return;
    }
    if (password !== confirmPassword) {
      setLocalError("Passwords do not match");
      return;
    }

    setSubmitting(true);
    try {
      const user = await registerUser(name.trim(), email.trim(), password);
      // Redirect based on user role
      const redirectPath = user.role === "admin" ? "/analytics" : "/dashboard";
      navigate(redirectPath, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg p-8 space-y-6">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-emerald-500">Create access</p>
          <h1 className="text-2xl font-extrabold text-gray-900 mt-2">Register for SmartPark</h1>
          <p className="text-sm text-gray-500 mt-1">
            Create a user account to explore analytics. Administrators can promote accounts from the console.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="text-xs uppercase text-gray-500">Full name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Doe"
              className="mt-1 w-full border border-gray-200 rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500"
            />
          </div>
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
            <p className="text-xs text-gray-400 mt-1">Use at least 8 chars, mixed case, and a number.</p>
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
          {(localError || error) && (
            <p className="text-sm text-red-500">{localError || error}</p>
          )}
          <button
            type="submit"
            className="w-full bg-emerald-500 text-white font-semibold py-3 rounded-full hover:bg-emerald-400 transition disabled:opacity-60"
            disabled={submitting}
          >
            {submitting ? "Creating account..." : "Create account"}
          </button>
        </form>
        <p className="text-sm text-gray-500">
          Already have an account?{" "}
          <Link to="/login" className="text-emerald-600 hover:underline font-semibold">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
