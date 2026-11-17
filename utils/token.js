import jwt from "jsonwebtoken";

const DEFAULT_ISSUER = "flareminds-billing";
const DEFAULT_AUDIENCE = "flareminds-admin";
const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

const issuer = () => process.env.JWT_ISSUER || DEFAULT_ISSUER;
const audience = () => process.env.JWT_AUDIENCE || DEFAULT_AUDIENCE;

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    const err = new Error("JWT_SECRET is not configured");
    err.status = 500;
    throw err;
  }
  return secret;
}

export function signAccessToken(admin) {
  return jwt.sign(
    {
      id: String(admin._id),
      email: admin.email,
      role: admin.role || "company_admin",
      companyId: admin.companyId ? String(admin.companyId) : null,
      type: "access",
    },
    getSecret(),
    {
      algorithm: "HS256",
      expiresIn: process.env.JWT_EXPIRES_IN || "12h",
      issuer: issuer(),
      audience: audience(),
    }
  );
}

export function verifyAccessToken(token) {
  const payload = jwt.verify(token, getSecret(), {
    algorithms: ["HS256"],
    issuer: issuer(),
    audience: audience(),
  });

  if (
    !payload ||
    payload.type !== "access" ||
    typeof payload.id !== "string" ||
    !OBJECT_ID_PATTERN.test(payload.id) ||
    typeof payload.email !== "string" ||
    !payload.email
  ) {
    throw new jwt.JsonWebTokenError("Invalid token claims");
  }

  return payload;
}
