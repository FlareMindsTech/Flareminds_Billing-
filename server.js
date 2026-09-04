import "dotenv/config";;

import express from "express";
import cors from "cors";
import morgan from "morgan";
import "express-async-errors"; // lets thrown errors in async route handlers reach the error middleware
import { connectDB } from "./config/db.js";
import { seedAdminFromEnv } from "./utils/seedAdmin.js";
import { requireAuth } from "./middleware/auth.js";
import authRoutes from "./routes/authRoutes.js";
import clientRoutes from "./routes/clientRoutes.js";
import invoiceRoutes from "./routes/invoiceRoutes.js";

const app = express();

app.use(cors({ origin: process.env.CLIENT_URL || "*" }));
app.use(express.json());
app.use(morgan("dev"));

console.log("DEBUG WHATSAPP_PHONE_NUMBER_ID:", process.env.WHATSAPP_PHONE_NUMBER_ID);
console.log("DEBUG WHATSAPP_ACCESS_TOKEN exists:", !!process.env.WHATSAPP_ACCESS_TOKEN);

app.get("/api/health", (req, res) => res.json({ status: "ok" }));
app.use("/api/auth", authRoutes);
app.use("/api/clients", requireAuth, clientRoutes);
app.use("/api/invoices", requireAuth, invoiceRoutes);

// Central error handler - catches anything thrown/rejected in async route handlers
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ message: err.message || "Server error" });
});

const PORT = process.env.PORT || 5000;

connectDB().then(async () => {
  await seedAdminFromEnv();
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
});
