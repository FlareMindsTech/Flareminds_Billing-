import "dotenv/config";

import path from "path";
import { fileURLToPath } from "url";

import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import "express-async-errors"; // lets thrown errors in async route handlers reach the error middleware
import { connectDB } from "./config/db.js";
import { assertValidEnv } from "./config/validateEnv.js";
import { seedAdminFromEnv } from "./utils/seedAdmin.js";
import { migrateLegacyData } from "./utils/migrateRoles.js";
import { requireAuth } from "./middleware/auth.js";
import { resolveCompany } from "./middleware/company.js";
import { ensureDefaultCompany } from "./services/companyService.js";
import authRoutes from "./routes/authRoutes.js";
import clientRoutes from "./routes/clientRoutes.js";
import invoiceRoutes from "./routes/invoiceRoutes.js";
import quotationRoutes from "./routes/quotationRoutes.js";
import companyRoutes from "./routes/companyRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import companySettingsRoutes from "./routes/companySettingsRoutes.js";
import templateRoutes from "./routes/templateRoutes.js";
import { requireSuperadmin, requireCompanyAdmin } from "./middleware/role.js";
import { serveCompanyLogoProxy } from "./services/bunnyStorage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const status = Number(err.status || err.statusCode) || 500;
  const isServerError = status >= 500;

  // Log only non-sensitive diagnostics; never log headers, bodies, tokens or
  // full error objects (Axios/Mongoose errors can embed request configuration).
  console.error(
    `[error] ${req.method} ${req.originalUrl} -> ${status} ${err.name || "Error"}: ${err.message}`
  );

  res.status(status).json({
    message:
      isServerError && process.env.NODE_ENV === "production"
        ? "Server error"
        : err.message || "Server error",
  });
}

export function createApp() {
  const app = express();

  app.disable("x-powered-by");

  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy !== undefined && /^\d+$/.test(String(trustProxy))) {
    app.set("trust proxy", Number(trustProxy));
  } else if (trustProxy === undefined) {
    app.set("trust proxy", 1);
  }

  app.use(
    helmet({
      // The UI is served from a different origin (e.g. localhost:5173 / the
      // deployed frontend), so API responses must be readable cross-origin.
      crossOriginResourcePolicy: { policy: "cross-origin" },
    })
  );

  const allowedOrigins = (process.env.CLIENT_URL || "*")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        // Deny by omitting the CORS headers instead of throwing a 500.
        return callback(null, false);
      },
    })
  );

  app.use(express.json({ limit: "1mb" }));

  if (process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test") {
    app.use(morgan("dev"));
  }

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    // Successful logins should not consume the brute-force budget.
    skipSuccessfulRequests: true,
    message: { message: "Too many login attempts. Please try again later." },
  });

  app.get(["/api/health", "/billing/health"], (req, res) => res.json({ status: "ok" }));

  app.use(["/api/auth/login", "/billing/auth/login"], authLimiter);
  app.use(["/api/auth", "/billing/auth"], authRoutes);
  app.use(
    ["/api/admin", "/billing/admin"],
    requireAuth,
    requireSuperadmin,
    adminRoutes
  );
  app.use(
    ["/api/company", "/billing/company"],
    requireAuth,
    requireCompanyAdmin,
    resolveCompany,
    companySettingsRoutes
  );
  app.use(
    ["/api/templates", "/billing/templates"],
    requireAuth,
    resolveCompany,
    templateRoutes
  );
  app.use(["/api/companies", "/billing/companies"], requireAuth, companyRoutes);
  app.use(
    ["/api/clients", "/billing/clients"],
    requireAuth,
    resolveCompany,
    clientRoutes
  );
  app.use(
    ["/api/invoices", "/billing/invoices"],
    requireAuth,
    resolveCompany,
    invoiceRoutes
  );
  app.use(
    ["/api/quotations", "/billing/quotations"],
    requireAuth,
    resolveCompany,
    quotationRoutes
  );

  app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  });

  app.get("/health", (req, res) => {
    res.status(200).json({
      status: "ok",
      service: "Flareminds Billing API",
      version: "1.0.0",
      environment: process.env.NODE_ENV || "development",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // Proxy company logos through the backend so logo previews (Branding) never
  // depend on the CDN allowing the page's or a null origin. Only the configured
  // CDN host is proxied (SSRF guard inside the handler).
  app.get(["/api/uploads/logo", "/billing/uploads/logo"], serveCompanyLogoProxy);

  // JSON 404 for API routes instead of falling through to Express' HTML page.
  app.use(["/api", "/billing"], (req, res) => {
    res.status(404).json({ message: "Not found" });
  });

  // Central error handler - catches anything thrown/rejected in async route handlers
  app.use(errorHandler);

  return app;
}

export const app = createApp();

export async function start() {
  assertValidEnv(process.env);

  await connectDB();
  await seedAdminFromEnv();
  await ensureDefaultCompany();
  await migrateLegacyData({ superadminEmail: process.env.ADMIN_EMAIL });

  const port = Number(process.env.PORT) || 5000;

  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      console.log(`Server running on http://localhost:${port}`);
      resolve(server);
    });
    server.on("error", reject);
  });
}

const isMainModule =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  start().catch((err) => {
    console.error(`Startup failed: ${err.message}`);
    process.exit(1);
  });
}
