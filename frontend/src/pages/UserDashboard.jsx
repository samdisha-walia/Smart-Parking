import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { Link } from "react-router-dom";
import { Car, CreditCard, Bell, Star, MapPin, Clock, TrendingUp, AlertCircle } from "lucide-react";
import request from "../lib/api";

export default function UserDashboard() {
  const { user, authorizedRequest } = useAuth();
  const [vehicles, setVehicles] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [payments, setPayments] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalVehicles: 0,
    activeReservations: 0,
    totalPayments: 0,
    unreadNotifications: 0,
  });

  useEffect(() => {
    const fetchUserData = async () => {
      try {
        // Add fallback data in case API fails
        const fallbackData = {
          vehicles: [],
          reservations: [],
          payments: [],
          notifications: [],
        };

        try {
          const vehiclesRes = await authorizedRequest("/user/vehicles");
          setVehicles(vehiclesRes || []);
        } catch (err) {
          console.warn("Vehicles API failed:", err);
          setVehicles(fallbackData.vehicles);
        }

        try {
          const reservationsRes = await authorizedRequest("/user/reservations");
          setReservations(reservationsRes || []);
        } catch (err) {
          console.warn("Reservations API failed:", err);
          setReservations(fallbackData.reservations);
        }

        try {
          const paymentsRes = await authorizedRequest("/user/payments");
          setPayments(paymentsRes || []);
        } catch (err) {
          console.warn("Payments API failed:", err);
          setPayments(fallbackData.payments);
        }

        try {
          const notificationsRes = await authorizedRequest("/user/notifications?unread_only=true");
          setNotifications(notificationsRes || []);
        } catch (err) {
          console.warn("Notifications API failed:", err);
          setNotifications(fallbackData.notifications);
        }

      } catch (error) {
        console.error("Failed to fetch user data:", error);
      } finally {
        setLoading(false);
      }
    };

    if (user) {
      fetchUserData();
    }
  }, [user, authorizedRequest]);

  // Update stats whenever data changes
  useEffect(() => {
    setStats({
      totalVehicles: vehicles?.length || 0,
      activeReservations: reservations?.filter(r => r.status === "confirmed" || r.status === "pending")?.length || 0,
      totalPayments: payments?.length || 0,
      unreadNotifications: notifications?.length || 0,
    });
  }, [vehicles, reservations, payments, notifications]);

  // Add demo data for better visibility
  const demoReservations = [
    {
      id: 1,
      slot_id: "A12",
      start_time: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      status: "confirmed"
    },
    {
      id: 2,
      slot_id: "B08",
      start_time: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
      status: "completed"
    }
  ];

  const demoNotifications = [
    {
      id: 1,
      type: "payment",
      title: "Payment Successful",
      message: "Your payment of ₹120 was successful",
      created_at: new Date().toISOString()
    },
    {
      id: 2,
      type: "info",
      title: "Reservation Reminder",
      message: "Your parking reservation starts in 2 hours",
      created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString()
    }
  ];

  const displayReservations = reservations.length > 0 ? reservations : demoReservations;
  const displayPayments = payments.length > 0 ? payments : [];
  const displayNotifications = notifications.length > 0 ? notifications : demoNotifications;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading your dashboard...</div>
      </div>
    );
  }

  const recentReservations = displayReservations.slice(0, 3);
  const recentPayments = displayPayments.slice(0, 3);
  const recentNotifications = displayNotifications.slice(0, 3);

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Welcome back, {user?.name}</h1>
          <p className="text-gray-600 mt-2">Here's an overview of your parking activity</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">My Vehicles</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{stats.totalVehicles}</p>
              </div>
              <div className="bg-blue-100 p-3 rounded-lg">
                <Car className="h-6 w-6 text-blue-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Active Reservations</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{stats.activeReservations}</p>
              </div>
              <div className="bg-green-100 p-3 rounded-lg">
                <Clock className="h-6 w-6 text-green-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Payments</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{stats.totalPayments}</p>
              </div>
              <div className="bg-purple-100 p-3 rounded-lg">
                <CreditCard className="h-6 w-6 text-purple-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm p-6 border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Unread Notifications</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{stats.unreadNotifications}</p>
              </div>
              <div className="bg-red-100 p-3 rounded-lg">
                <Bell className="h-6 w-6 text-red-600" />
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Recent Reservations */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200">
              <div className="p-6 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Recent Reservations</h2>
                <p className="text-sm text-gray-600 mt-1">Your latest parking bookings</p>
              </div>
              <div className="p-6">
                {recentReservations.length === 0 ? (
                  <div className="text-center py-8">
                    <Clock className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-500">No reservations yet</p>
                    <button className="mt-4 text-blue-600 hover:text-blue-700 font-medium">
                      Book your first spot
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {recentReservations.map((reservation) => (
                      <div key={reservation.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                        <div className="flex items-center space-x-4">
                          <div className="bg-blue-100 p-2 rounded-lg">
                            <MapPin className="h-5 w-5 text-blue-600" />
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">Slot {reservation.slot_id}</p>
                            <p className="text-sm text-gray-600">
                              {new Date(reservation.start_time).toLocaleDateString()} •{" "}
                              {new Date(reservation.start_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            reservation.status === "confirmed" 
                              ? "bg-green-100 text-green-800"
                              : reservation.status === "pending"
                              ? "bg-yellow-100 text-yellow-800"
                              : "bg-gray-100 text-gray-800"
                          }`}>
                            {reservation.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Recent Notifications */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200">
              <div className="p-6 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">Notifications</h2>
                <p className="text-sm text-gray-600 mt-1">Latest updates and alerts</p>
              </div>
              <div className="p-6">
                {recentNotifications.length === 0 ? (
                  <div className="text-center py-8">
                    <Bell className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-500">No new notifications</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {recentNotifications.map((notification) => (
                      <div key={notification.id} className="p-4 bg-gray-50 rounded-lg">
                        <div className="flex items-start space-x-3">
                          <div className={`p-2 rounded-lg ${
                            notification.type === "payment" 
                              ? "bg-green-100"
                              : notification.type === "alert"
                              ? "bg-red-100"
                              : "bg-blue-100"
                          }`}>
                            {notification.type === "payment" ? (
                              <CreditCard className="h-4 w-4 text-green-600" />
                            ) : notification.type === "alert" ? (
                              <AlertCircle className="h-4 w-4 text-red-600" />
                            ) : (
                              <Bell className="h-4 w-4 text-blue-600" />
                            )}
                          </div>
                          <div className="flex-1">
                            <p className="font-medium text-gray-900 text-sm">{notification.title}</p>
                            <p className="text-xs text-gray-600 mt-1">{notification.message}</p>
                            <p className="text-xs text-gray-500 mt-2">
                              {new Date(notification.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="mt-8 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Link 
              to="/profile" 
              className="flex flex-col items-center justify-center p-4 bg-blue-50 rounded-lg hover:bg-blue-100 transition"
            >
              <Car className="h-8 w-8 text-blue-600 mb-2" />
              <span className="text-sm font-medium text-gray-900">Add Vehicle</span>
            </Link>
            <Link 
              to="/parking" 
              className="flex flex-col items-center justify-center p-4 bg-green-50 rounded-lg hover:bg-green-100 transition"
            >
              <MapPin className="h-8 w-8 text-green-600 mb-2" />
              <span className="text-sm font-medium text-gray-900">Book Slot</span>
            </Link>
            <button 
              onClick={() => alert('Payment history feature coming soon!')}
              className="flex flex-col items-center justify-center p-4 bg-purple-50 rounded-lg hover:bg-purple-100 transition"
            >
              <CreditCard className="h-8 w-8 text-purple-600 mb-2" />
              <span className="text-sm font-medium text-gray-900">Payment History</span>
            </button>
            <button 
              onClick={() => alert('Feedback feature coming soon!')}
              className="flex flex-col items-center justify-center p-4 bg-yellow-50 rounded-lg hover:bg-yellow-100 transition"
            >
              <Star className="h-8 w-8 text-yellow-600 mb-2" />
              <span className="text-sm font-medium text-gray-900">Give Feedback</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
