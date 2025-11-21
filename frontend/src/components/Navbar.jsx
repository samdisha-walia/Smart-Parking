import { Link, useLocation } from "react-router-dom";
import { CarFront } from "lucide-react";

export default function Navbar() {
  const location = useLocation();
  const active = (path) =>
    location.pathname === path ? "text-emerald-400" : "text-gray-300 hover:text-white";

  return (
    <nav className="bg-gray-900/95 backdrop-blur-md border-b border-gray-700 text-white 
                    flex justify-between items-center px-10 py-4 shadow-lg sticky top-0 z-50">
      <div className="flex items-center gap-2">
        <CarFront size={26} className="text-emerald-400" />
        <h1 className="text-2xl font-semibold tracking-wide">SmartPark</h1>
      </div>
      <div className="flex gap-8 text-lg">
        <Link to="/" className={active("/")}>Home</Link>
        <Link to="/parking" className={active("/parking")}>Parking</Link>
        <Link to="/analytics" className={active("/analytics")}>Analytics</Link>
      </div>
    </nav>
  );
}
