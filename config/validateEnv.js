const isProduction = (env) => env.NODE_ENV === "production";

// Returns validation errors (fatal) and warnings (non-fatal) without
// reading or exposing any secret values.
export function validateEnv(env = process.env) {
  const errors = [];
  const warnings = [];
  const production = isProduction(env);

  if (!env.MONGO_URI) errors.push("MONGO_URI is required.");

  if (!env.JWT_SECRET) {
    errors.push("JWT_SECRET is required.");
  } else if (env.JWT_SECRET.length < 32) {
    const message = "JWT_SECRET should be at least 32 characters long.";
    if (production) errors.push(message);
    else warnings.push(message);
  }

  if (production && !env.CLIENT_URL) {
    errors.push("CLIENT_URL is required in production.");
  } else if (!production && !env.CLIENT_URL) {
    warnings.push("CLIENT_URL is not set; CORS will allow any origin (development only).");
  }

  const origins = String(env.CLIENT_URL || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (production && origins.includes("*")) {
    errors.push("CLIENT_URL must not contain '*' in production.");
  }

  for (const origin of origins) {
    if (origin === "*") continue;
    try {
      const parsed = new URL(origin);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        errors.push(`CLIENT_URL origin must use http(s): ${origin}`);
        continue;
      }
      // CORS compares exact origins, so a path/query here could never match.
      if ((parsed.pathname !== "/" && parsed.pathname !== "") || parsed.search || parsed.hash) {
        const message = `CLIENT_URL origin should not include a path or query: ${origin}`;
        if (isProduction(env)) errors.push(message);
        else warnings.push(message);
      }
    } catch {
      errors.push(`CLIENT_URL contains an invalid origin: ${origin}`);
    }
  }

  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    warnings.push("ADMIN_EMAIL / ADMIN_PASSWORD not set; admin seeding will be skipped.");
  }

  const smtpKeys = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"];
  const smtpConfigured = smtpKeys.filter((key) => env[key]).length;
  if (smtpConfigured > 0 && smtpConfigured < smtpKeys.length) {
    warnings.push("SMTP configuration is incomplete; email delivery will fail.");
  }

  const whatsappKeys = ["WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN"];
  const whatsappConfigured = whatsappKeys.filter((key) => env[key]).length;
  if (whatsappConfigured === 1) {
    warnings.push("WhatsApp configuration is incomplete; WhatsApp delivery will fail.");
  }

  if (env.TRUST_PROXY !== undefined && !/^\d+$/.test(String(env.TRUST_PROXY))) {
    warnings.push("TRUST_PROXY should be a number (count of reverse proxies in front of Express).");
  }

  if (env.PORT !== undefined && !/^\d+$/.test(String(env.PORT))) {
    warnings.push("PORT should be numeric.");
  }

  return { errors, warnings, production };
}

export function assertValidEnv(env = process.env) {
  const { errors, warnings } = validateEnv(env);

  for (const warning of warnings) {
    console.warn(`[config] ${warning}`);
  }

  if (errors.length > 0) {
    throw new Error(`Invalid configuration:\n- ${errors.join("\n- ")}`);
  }
}
