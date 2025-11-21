import { CarFront } from "lucide-react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";

export default function Home() {
  return (
    <section className="relative min-h-[90vh] flex flex-col justify-center items-center text-center overflow-hidden">
      {/* 🌈 Animated gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-gray-900 via-emerald-900 to-black animate-gradient-move"></div>

      {/* 🔆 Soft overlay for readability */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"></div>

      {/* ✨ Content */}
      <motion.div
        initial={{ opacity: 0, y: 50 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1 }}
        className="relative z-10 flex flex-col items-center text-white space-y-6 px-4"
      >
        {/* 🚗 Glowing animated car icon */}
        <motion.div
          animate={{
            y: [0, -10, 0],
            boxShadow: [
              "0 0 20px rgba(16, 185, 129, 0.5)",
              "0 0 40px rgba(16, 185, 129, 0.8)",
              "0 0 20px rgba(16, 185, 129, 0.5)",
            ],
          }}
          transition={{
            duration: 3,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        >
          <CarFront size={90} className="text-emerald-400 drop-shadow-[0_0_20px_rgba(16,185,129,0.8)]" />
        </motion.div>

        {/* 🧠 Title + Subtitle */}
        <motion.h1
          className="text-5xl sm:text-6xl font-extrabold tracking-tight"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          Welcome to <span className="text-emerald-400">SmartPark</span>
        </motion.h1>

        <motion.p
          className="max-w-2xl text-gray-300 text-lg leading-relaxed"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
        >
          Revolutionizing urban mobility with AI-powered smart parking.
          Real-time detection, predictive analytics, and seamless booking —
          all in one intuitive platform.
        </motion.p>

        {/* 🎯 Call to action */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 1 }}
        >
          <Link
            to="/parking"
            className="bg-emerald-500 px-8 py-3 rounded-full font-semibold text-white shadow-lg 
                       hover:bg-emerald-600 hover:shadow-emerald-400/50 transition transform hover:scale-105"
          >
            Explore Parking
          </Link>
        </motion.div>
      </motion.div>
    </section>
  );
}
