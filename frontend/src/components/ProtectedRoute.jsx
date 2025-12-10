import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ children, allowed }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white">
        <p className="text-sm text-slate-300">Validating session...</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (allowed && !allowed.includes(user.role)) {
    const fallback = user.role === "admin" ? "/admin" : "/analytics";
    return <Navigate to={fallback} replace />;
  }

  return children;
}
