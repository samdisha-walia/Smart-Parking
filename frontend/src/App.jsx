import { BrowserRouter, Routes, Route, Outlet } from "react-router-dom";
import Navbar from "./components/Navbar";
import Home from "./pages/Home";
import Parking from "./pages/Parking";
import Booking from "./pages/Booking";
import Analytics from "./pages/Analytics";
import Admin from "./pages/Admin";
import UserDashboard from "./pages/UserDashboard";
import UserProfile from "./pages/UserProfile";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import ProtectedRoute from "./components/ProtectedRoute";
import { useAuth } from "./context/AuthContext";

function UserLayout() {
  const { user } = useAuth();
  return (
    <ProtectedRoute allowed={["user", "admin"]}>
      <div className="min-h-screen bg-gray-950 text-white">
        <Navbar />
        <Outlet context={{ user }} />
      </div>
    </ProtectedRoute>
  );
}

function AdminLayout() {
  const { user } = useAuth();
  return (
    <ProtectedRoute allowed={["admin"]}>
      <div className="min-h-screen bg-slate-950 text-white">
        <Navbar />
        <Outlet context={{ user }} />
      </div>
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/parking" element={<Parking />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        <Route element={<UserLayout />}>
          <Route path="/dashboard" element={<UserDashboard />} />
          <Route path="/profile" element={<UserProfile />} />
          <Route path="/booking" element={<Booking />} />
          <Route path="/analytics" element={<Analytics />} />
        </Route>

        <Route element={<AdminLayout />}>
          <Route path="/admin" element={<Admin />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
