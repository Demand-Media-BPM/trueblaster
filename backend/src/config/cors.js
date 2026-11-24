const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5000",
  "https://localhost:3000",
  "https://truesendr.com",
  "https://truesendr-ui.vercel.app",
  "https://77fd70c33625.ngrok-free.app",
  "https://13.218.96.234:5000",
  "https://truenotsendr.com",
  "https://truesendr007.netlify.app",
  "https://app.demandmediaglobal.com",
  "https://api.demandmediaglobal.com",
];

const corsOptions = {
  origin: function (origin, callback) {
    let backendOrigin;
    try { backendOrigin = new URL(process.env.PUBLIC_API_URL).origin; } catch { }
    // A recipient submits the confirmation form from the API origin itself.
    if (!origin || allowedOrigins.includes(origin) || origin === backendOrigin) {
      callback(null, true);
    } else {
      console.error("⛔ CORS blocked origin:", origin);
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization", "ngrok-skip-browser-warning"],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
};

module.exports = corsOptions;
