import { Link, useLocation, useNavigate } from "react-router-dom";
import { CarFront } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function Navbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const active = (path) =>
    location.pathname === path ? "text-emerald-400" : "text-gray-300 hover:text-white";

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  return (
    <nav className="bg-gray-900/95 backdrop-blur-md border-b border-gray-700 text-white 
                    flex justify-between items-center px-10 py-4 shadow-lg sticky top-0 z-50">
      <div className="flex items-center gap-2">
        <CarFront size={26} className="text-emerald-400" />
        <h1 className="text-2xl font-semibold tracking-wide">SmartPark</h1>
      </div>
      <div className="flex items-center gap-8 text-lg">
        <Link to="/" className={active("/")}>Home</Link>
        <Link to="/parking" className={active("/parking")}>Parking</Link>
        {user ? (
          <>
            <Link to="/dashboard" className={active("/dashboard")}>Dashboard</Link>
            <Link to="/profile" className={active("/profile")}>Profile</Link>
            {user.role === "admin" && (
              <>
                <Link to="/analytics" className={active("/analytics")}>Analytics</Link>
                <Link to="/admin" className={active("/admin")}>Admin</Link>
              </>
            )}
            <button
              onClick={handleLogout}
              className="text-sm font-semibold bg-white/10 px-4 py-2 rounded-full hover:bg-white/20 transition"
            >
              Logout ({user.role})
            </button>
          </>
        ) : (
          <>
            <Link to="/analytics" className={active("/analytics")}>Analytics</Link>
            <Link to="/admin" className={active("/admin")}>Admin</Link>
            <Link
              to="/login"
              className="text-sm font-semibold bg-emerald-500 px-4 py-2 rounded-full hover:bg-emerald-400 transition"
            >
              Login
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}
