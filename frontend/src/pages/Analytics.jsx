import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const data = [
  { time: "9 AM", demand: 30 },
  { time: "11 AM", demand: 50 },
  { time: "1 PM", demand: 80 },
  { time: "3 PM", demand: 70 },
  { time: "5 PM", demand: 95 },
  { time: "7 PM", demand: 110 },
];

export default function Analytics() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-6">
      <h2 className="text-3xl font-bold text-center mb-10 text-gray-800">
        Parking Demand Prediction
      </h2>
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-3xl mx-auto">
        <ResponsiveContainer width="100%" height={350}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#ddd" />
            <XAxis dataKey="time" stroke="#555" />
            <YAxis stroke="#555" />
            <Tooltip />
            <Line type="monotone" dataKey="demand" stroke="#10b981" strokeWidth={3} dot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
