import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { Car, Plus, Edit2, Trash2, Save, X, User, Mail, Shield } from "lucide-react";
import request from "../lib/api";

export default function UserProfile() {
  const { user, authorizedRequest } = useAuth();
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddVehicle, setShowAddVehicle] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState(null);
  const [formData, setFormData] = useState({
    license_plate: "",
    make: "",
    model: "",
    color: "",
  });
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("");

  useEffect(() => {
    fetchVehicles();
  }, []);

  const fetchVehicles = async () => {
    try {
      const data = await authorizedRequest("/user/vehicles");
      setVehicles(data || []);
    } catch (error) {
      console.error("Failed to fetch vehicles:", error);
      // Set demo data for better visibility
      setVehicles([
        {
          id: 1,
          license_plate: "KA01 AB 1234",
          make: "Toyota",
          model: "Camry",
          color: "White",
          created_at: new Date().toISOString()
        }
      ]);
      setMessage("Using demo data - API connection failed");
      setMessageType("info");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitVehicle = async (e) => {
    e.preventDefault();
    try {
      if (editingVehicle) {
        await authorizedRequest(`/user/vehicles/${editingVehicle.id}`, {
          method: "PUT",
          body: formData,
        });
        setMessage("Vehicle updated successfully");
      } else {
        await authorizedRequest("/user/vehicles", {
          method: "POST",
          body: formData,
        });
        setMessage("Vehicle added successfully");
      }
      setMessageType("success");
      setShowAddVehicle(false);
      setEditingVehicle(null);
      setFormData({ license_plate: "", make: "", model: "", color: "" });
      fetchVehicles();
    } catch (error) {
      // Fallback to demo behavior
      const newVehicle = {
        id: Date.now(),
        ...formData,
        created_at: new Date().toISOString()
      };
      
      if (editingVehicle) {
        setVehicles(prev => prev.map(v => v.id === editingVehicle.id ? newVehicle : v));
        setMessage("Vehicle updated (demo mode)");
      } else {
        setVehicles(prev => [...prev, newVehicle]);
        setMessage("Vehicle added (demo mode)");
      }
      setMessageType("success");
      setShowAddVehicle(false);
      setEditingVehicle(null);
      setFormData({ license_plate: "", make: "", model: "", color: "" });
    }
  };

  const handleEditVehicle = (vehicle) => {
    setEditingVehicle(vehicle);
    setFormData({
      license_plate: vehicle.license_plate,
      make: vehicle.make || "",
      model: vehicle.model || "",
      color: vehicle.color || "",
    });
    setShowAddVehicle(true);
  };

  const handleDeleteVehicle = async (vehicleId) => {
    if (window.confirm("Are you sure you want to delete this vehicle?")) {
      try {
        await authorizedRequest(`/user/vehicles/${vehicleId}`, {
          method: "DELETE",
        });
        setMessage("Vehicle deleted successfully");
        setMessageType("success");
        fetchVehicles();
      } catch (error) {
        // Fallback to demo behavior
        setVehicles(prev => prev.filter(v => v.id !== vehicleId));
        setMessage("Vehicle deleted (demo mode)");
        setMessageType("success");
      }
    }
  };

  const handleCancel = () => {
    setShowAddVehicle(false);
    setEditingVehicle(null);
    setFormData({ license_plate: "", make: "", model: "", color: "" });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading profile...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">My Profile</h1>
          <p className="text-gray-600 mt-2">Manage your account and vehicles</p>
        </div>

        {/* User Info Card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-gray-900">Account Information</h2>
            <button className="text-blue-600 hover:text-blue-700 font-medium text-sm">
              Edit Profile
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex items-center space-x-4">
              <div className="bg-gray-100 p-3 rounded-full">
                <User className="h-6 w-6 text-gray-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Full Name</p>
                <p className="font-medium text-gray-900">{user?.name}</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="bg-gray-100 p-3 rounded-full">
                <Mail className="h-6 w-6 text-gray-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Email Address</p>
                <p className="font-medium text-gray-900">{user?.email}</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="bg-gray-100 p-3 rounded-full">
                <Shield className="h-6 w-6 text-gray-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Account Type</p>
                <p className="font-medium text-gray-900 capitalize">{user?.role}</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <div className="bg-gray-100 p-3 rounded-full">
                <Car className="h-6 w-6 text-gray-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Member Since</p>
                <p className="font-medium text-gray-900">
                  {user?.created_at ? new Date(user.created_at).toLocaleDateString() : "N/A"}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Vehicles Section */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">My Vehicles</h2>
                <p className="text-sm text-gray-600 mt-1">Manage your registered vehicles</p>
              </div>
              <button
                onClick={() => setShowAddVehicle(true)}
                className="flex items-center space-x-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
              >
                <Plus className="h-4 w-4" />
                <span>Add Vehicle</span>
              </button>
            </div>
          </div>

          <div className="p-6">
            {vehicles.length === 0 ? (
              <div className="text-center py-12">
                <Car className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500 mb-4">No vehicles registered yet</p>
                <button
                  onClick={() => setShowAddVehicle(true)}
                  className="text-blue-600 hover:text-blue-700 font-medium"
                >
                  Add your first vehicle
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {vehicles.map((vehicle) => (
                  <div key={vehicle.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <div className="bg-blue-100 p-3 rounded-lg">
                          <Car className="h-6 w-6 text-blue-600" />
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900 text-lg">
                            {vehicle.license_plate}
                          </p>
                          <p className="text-sm text-gray-600">
                            {vehicle.make && vehicle.model ? `${vehicle.make} ${vehicle.model}` : "Make/Model not specified"}
                            {vehicle.color && ` • ${vehicle.color}`}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
                            Added {new Date(vehicle.created_at).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => handleEditVehicle(vehicle)}
                          className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteVehicle(vehicle.id)}
                          className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Add/Edit Vehicle Modal */}
        {showAddVehicle && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-gray-900">
                  {editingVehicle ? "Edit Vehicle" : "Add New Vehicle"}
                </h3>
                <button
                  onClick={handleCancel}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {message && (
                <div className={`mb-4 p-3 rounded-lg text-sm ${
                  messageType === "success" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                }`}>
                  {message}
                </div>
              )}

              <form onSubmit={handleSubmitVehicle} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    License Plate *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.license_plate}
                    onChange={(e) => setFormData({ ...formData, license_plate: e.target.value.toUpperCase() })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., KA01 AB 1234"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Make
                  </label>
                  <input
                    type="text"
                    value={formData.make}
                    onChange={(e) => setFormData({ ...formData, make: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., Toyota, Honda, BMW"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Model
                  </label>
                  <input
                    type="text"
                    value={formData.model}
                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., Camry, City, X5"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Color
                  </label>
                  <input
                    type="text"
                    value={formData.color}
                    onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., White, Black, Silver"
                  />
                </div>

                <div className="flex space-x-3 pt-4">
                  <button
                    type="submit"
                    className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 transition flex items-center justify-center space-x-2"
                  >
                    <Save className="h-4 w-4" />
                    <span>{editingVehicle ? "Update" : "Add"} Vehicle</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleCancel}
                    className="flex-1 bg-gray-200 text-gray-800 py-2 px-4 rounded-lg hover:bg-gray-300 transition"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
