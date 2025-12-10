import { useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import SimpleNav from "../components/SimpleNav";

export default function Parking() {
  const [slots] = useState([
    { id: 1, status: "available" },
    { id: 2, status: "occupied" },
    { id: 3, status: "available" },
    { id: 4, status: "occupied" },
    { id: 5, status: "available" },
    { id: 6, status: "available" },
  ]);

  // 🖼️ Carousel data
   const detectionImages = [
    "/cloudy.PNG",
    "/Rainy.PNG",
    "/sunny.PNG",
    "/UFPR04_cloudy.png",
    "/UFPR04_rainy.png",
    "/UFPR04_sunny.png",
    "/UFPR05_cloudy.png",
    "/UFPR05_rainy.png",
    "/UFPR05_sunny.png",
  ];

  const [currentIndex, setCurrentIndex] = useState(0);

  const handleNext = () => {
    setCurrentIndex((prev) => (prev + 1) % detectionImages.length);
  };

  const handlePrev = () => {
    setCurrentIndex((prev) =>
      prev === 0 ? detectionImages.length - 1 : prev - 1
    );
  };

  return (
    <>
      <SimpleNav />
      <div className="min-h-screen bg-gray-100 py-12 px-4">
      <h2 className="text-3xl font-bold text-center mb-10 text-gray-800">
        Parking Lot Overview
      </h2>

      <div className="flex flex-col gap-12 items-center">
        {/* 🖼️ Image Detection Output */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="bg-white/70 backdrop-blur-md rounded-2xl shadow-lg p-5 w-full max-w-4xl"
        >
          <h3 className="text-xl font-semibold text-gray-700 mb-4 text-center">
            🖼️ AI Detection Output – Image Mode
          </h3>
          <motion.img
            src="/UFPR05_rainy.png"
            alt="AI Detection Image Preview"
            className="rounded-xl shadow-md w-full object-cover"
            whileHover={{ scale: 1.02 }}
            transition={{ duration: 0.3 }}
          />
          <p className="text-center text-gray-600 text-sm mt-3 italic">
            Example detection from YOLOv8 model on captured frame.
          </p>
        </motion.div>

        {/* 🖼️ Clickable Carousel */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.1 }}
          className="bg-white/70 backdrop-blur-md rounded-2xl shadow-lg p-6 w-full max-w-5xl relative overflow-hidden"
        >
          <h3 className="text-xl font-semibold text-gray-700 mb-4 text-center">
            Detection Gallery – Interactive Carousel
          </h3>

          <div className="relative flex items-center justify-center">
            {/* ← Left Button */}
            <button
              onClick={handlePrev}
              className="absolute left-2 sm:left-4 text-gray-700 bg-white/80 hover:bg-emerald-500 hover:text-white p-2 sm:p-3 rounded-full shadow-md transition-all"
            >
              <ChevronLeft size={24} />
            </button>

            {/* Image Frame */}
            <div className="w-full max-w-3xl h-[320px] flex justify-center items-center overflow-hidden rounded-xl shadow-md">
              <AnimatePresence mode="wait">
                <motion.img
                  key={currentIndex}
                  src={detectionImages[currentIndex]}
                  alt={`Detection ${currentIndex + 1}`}
                  className="w-full h-full object-cover rounded-xl"
                  initial={{ opacity: 0, x: 100 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -100 }}
                  transition={{ duration: 0.5 }}
                />
              </AnimatePresence>
            </div>

            {/* → Right Button */}
            <button
              onClick={handleNext}
              className="absolute right-2 sm:right-4 text-gray-700 bg-white/80 hover:bg-emerald-500 hover:text-white p-2 sm:p-3 rounded-full shadow-md transition-all"
            >
              <ChevronRight size={24} />
            </button>
          </div>

          {/* Indicator Dots */}
          <div className="flex justify-center mt-4 gap-2">
            {detectionImages.map((_, idx) => (
              <div
                key={idx}
                className={`w-3 h-3 rounded-full ${
                  idx === currentIndex
                    ? "bg-emerald-500 scale-110"
                    : "bg-gray-400"
                } transition-all`}
              ></div>
            ))}
          </div>

          <p className="text-center text-gray-600 text-sm mt-4 italic">
            Browse through AI detection results from 9 different frames.
          </p>
        </motion.div>

        {/* 🎥 Video Detection Output */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.1, delay: 0.2 }}
          className="bg-white/70 backdrop-blur-md rounded-2xl shadow-lg p-5 w-full max-w-4xl"
        >
          <h3 className="text-xl font-semibold text-gray-700 mb-4 text-center">
            🎥Video Mode
          </h3>
          <motion.video
            src="/space2.mp4"
            controls
            autoPlay
            loop
            muted
            className="rounded-xl shadow-md w-full object-cover"
            whileHover={{ scale: 1.02 }}
            transition={{ duration: 0.3 }}
          />
          <p className="text-center text-gray-600 text-sm mt-3 italic">
            Live monitoring with YOLOv8 real-time occupancy detection.
          </p>
        </motion.div>
      </div>

      {/* 🅿️ Slot Grid Section */}
{/* 🅿️ Custom Parking Slot Grid Section */}
<motion.div
  initial={{ opacity: 0, y: 40 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 1, delay: 0.4 }}
  className="mt-16"
>
  <h3 className="text-2xl font-bold text-center mb-8 text-gray-800">
    Parking Slot Status Overview
  </h3>

  <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-4 max-w-6xl mx-auto">
    {[...Array(41)].map((_, i) => {
      const slotNumber = i + 1;
      // define occupied slots
      const occupiedSlots = [1, 10, 11, 29, 30, 32];
      const isAvailable = !occupiedSlots.includes(slotNumber);

      return (
        <Link
          key={slotNumber}
          to={isAvailable ? `/booking?slot=${slotNumber}` : "#"}
          className={`${!isAvailable && "cursor-not-allowed"}`}
        >
          <motion.div
            whileHover={isAvailable ? { scale: 1.07 } : {}}
            transition={{ duration: 0.2 }}
            className={`rounded-xl h-20 flex flex-col justify-center items-center 
                        shadow-md hover:shadow-lg transition-transform
                        ${
                          isAvailable
                            ? "bg-emerald-500/90 text-white hover:bg-emerald-600"
                            : "bg-red-500/90 text-white opacity-80"
                        }`}
          >
            <span className="font-bold text-lg">S{slotNumber}</span>
            <span className="text-xs opacity-90">
              {isAvailable ? "Available" : "Occupied"}
            </span>
          </motion.div>
        </Link>
      );
    })}
  </div>

  <div className="text-center mt-10 text-gray-600">
    <p>
      Color Legend:{" "}
      <span className="text-emerald-500 font-semibold">Available (35)</span> |{" "}
      <span className="text-red-500 font-semibold">Occupied (6)</span>
    </p>
  </div>
</motion.div>
    </div>
    </>
  );
}
