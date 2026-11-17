import bcrypt from "bcryptjs";
import Admin from "../models/Admin.js";
import Company from "../models/Company.js";
import { signAccessToken } from "../utils/token.js";
import { audit } from "../utils/auditLog.js";
import { isCompanyActive } from "../utils/companyStatus.js";

const INVALID_CREDENTIALS = "Invalid email or password";

// Used when the account does not exist so that response timing does not
// reveal whether an email address is registered.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("invalid-password-placeholder", 10);

function publicAdmin(admin, company = null) {
  return {
    email: admin.email,
    name: admin.name,
    role: admin.role || "company_admin",
    companyId: admin.companyId ? String(admin.companyId) : null,
    company: company
      ? {
          _id: String(company._id),
          name: company.name,
          code: company.code,
          status: company.status || (company.isActive === false ? "suspended" : "active"),
        }
      : null,
  };
}

export const login = async (req, res) => {
  const body = req.body || {};
  const email = body.email;
  const password = body.password;

  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    !email.trim() ||
    !password
  ) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  if (email.length > 254 || password.length > 1024) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const admin = await Admin.findOne({ email: normalizedEmail });
  const passwordHash = admin?.passwordHash || DUMMY_PASSWORD_HASH;
  const valid = await bcrypt.compare(password, passwordHash);

  if (!admin || !valid || admin.isActive === false) {
    audit("login_failed", { ip: req.ip, result: "denied" });
    return res.status(401).json({ message: INVALID_CREDENTIALS });
  }

  let company = null;
  if (admin.role !== "superadmin" && admin.companyId) {
    company = await Company.findById(admin.companyId);
    if (!company || !isCompanyActive(company)) {
      audit("login_failed", { actor: admin.email, ip: req.ip, result: "company_suspended" });
      return res.status(403).json({
        code: "COMPANY_SUSPENDED",
        message: company?.suspendedReason
          ? `This company is suspended: ${company.suspendedReason}`
          : "This company is suspended. Contact the platform administrator.",
      });
    }
  }

  admin.lastLoginAt = new Date();
  await admin.save();

  const token = signAccessToken(admin);

  audit("login_success", { actor: admin.email, ip: req.ip });

  res.json({
    token,
    admin: publicAdmin(admin, company),
  });
};

// Used by the frontend on load to check if a saved token is still valid.
export const me = async (req, res) => {
  const admin = await Admin.findById(req.admin.id).select(
    "email name isActive role companyId"
  );

  if (!admin || admin.isActive === false) {
    return res.status(401).json({ message: "Invalid or expired session, please log in again" });
  }

  let company = null;
  if (admin.role !== "superadmin" && admin.companyId) {
    company = await Company.findById(admin.companyId).select(
      "name code status isActive suspendedReason"
    );
    if (!company || !isCompanyActive(company)) {
      return res.status(403).json({
        code: "COMPANY_SUSPENDED",
        message: company?.suspendedReason
          ? `This company is suspended: ${company.suspendedReason}`
          : "This company is suspended. Contact the platform administrator.",
      });
    }
  }

  res.set("Cache-Control", "no-store");
  res.json(publicAdmin(admin, company));
};
