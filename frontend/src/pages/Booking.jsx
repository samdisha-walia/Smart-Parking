import { CheckCircle } from "lucide-react";

export default function Booking() {
  return (
    <div className="min-h-[80vh] flex flex-col justify-center items-center 
                    bg-gradient-to-tr from-gray-900 via-gray-800 to-black text-white space-y-6">
      <CheckCircle size={90} className="text-emerald-400 drop-shadow-lg" />
      <h2 className="text-4xl font-bold">Slot Reserved Successfully!</h2>
      <p className="text-gray-300 text-lg">
        Slot No: 3 | Duration: 2 Hours | ₹50
      </p>
      <button className="bg-emerald-500 text-white px-8 py-3 rounded-full 
                         font-semibold hover:bg-emerald-600 transition transform hover:scale-105">
        Download Pass
      </button>
    </div>
  );
}
