import { Link, useLocation } from "react-router-dom";
import { Home, Car, LogIn, User } from "lucide-react";

export default function SimpleNav() {
  const location = useLocation();
  
  const isActive = (path) => location.pathname === path;

  return (
    <nav className="bg-white/90 backdrop-blur-md shadow-lg sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <div className="flex items-center">
            <Link to="/" className="flex items-center space-x-2">
              <Car className="h-8 w-8 text-emerald-500" />
              <span className="text-xl font-bold text-gray-800">SmartPark</span>
            </Link>
          </div>

          {/* Navigation Links */}
          <div className="flex items-center space-x-4">
            <Link
              to="/"
              className={`flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive("/")
                  ? "bg-emerald-100 text-emerald-700"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              <Home className="h-4 w-4" />
              <span>Home</span>
            </Link>
            
            <Link
              to="/parking"
              className={`flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive("/parking")
                  ? "bg-emerald-100 text-emerald-700"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              <Car className="h-4 w-4" />
              <span>Parking</span>
            </Link>

            <Link
              to="/login"
              className={`flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive("/login")
                  ? "bg-emerald-100 text-emerald-700"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              <LogIn className="h-4 w-4" />
              <span>Login</span>
            </Link>

            <Link
              to="/dashboard"
              className={`flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive("/dashboard")
                  ? "bg-emerald-100 text-emerald-700"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              <User className="h-4 w-4" />
              <span>Dashboard</span>
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
