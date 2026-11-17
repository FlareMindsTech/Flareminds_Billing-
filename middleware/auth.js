import Admin from "../models/Admin.js";
import Company from "../models/Company.js";
import { verifyAccessToken } from "../utils/token.js";
import { isCompanyActive } from "../utils/companyStatus.js";

const INVALID_SESSION = "Invalid or expired session, please log in again";

async function defaultFindAdmin(id) {
  return Admin.findById(id)
    .select("_id email isActive role companyId")
    .lean();
}

// Exported as a factory so the token verifier and admin lookup can be
// substituted in security regression tests.
export function createRequireAuth({
  verify = verifyAccessToken,
  findAdmin = defaultFindAdmin,
} = {}) {
  return async function requireAuth(req, res, next) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;

    if (!token) return res.status(401).json({ message: "Not authenticated" });
    if (token.length > 4096) return res.status(401).json({ message: INVALID_SESSION });

    let payload;
    try {
      payload = verify(token);
    } catch {
      return res.status(401).json({ message: INVALID_SESSION });
    }

    try {
      // Revalidate on every request so deleted/disabled admins lose access
      // immediately instead of keeping a valid token until it expires.
      const admin = await findAdmin(payload.id);
      if (!admin || admin.isActive === false) {
        return res.status(401).json({ message: INVALID_SESSION });
      }

      const role = admin.role || "company_admin";
      const companyId = admin.companyId ? String(admin.companyId) : null;

      // A company admin is locked to the company and loses access the moment
      // that company is suspended - even if their token is still valid.
      if (role !== "superadmin" && companyId) {
        const company = await Company.findById(companyId).select(
          "name status isActive suspendedReason"
        );
        if (!company) {
          return res.status(401).json({ message: INVALID_SESSION });
        }
        if (!isCompanyActive(company)) {
          return res.status(403).json({
            code: "COMPANY_SUSPENDED",
            message: company.suspendedReason
              ? `This company is suspended: ${company.suspendedReason}`
              : "This company is suspended. Contact the platform administrator.",
          });
        }
        req.company = company;
        req.companyId = company._id;
      }

      req.admin = {
        id: String(admin._id ?? payload.id),
        email: admin.email || payload.email,
        role,
        companyId,
      };
      return next();
    } catch {
      // A database outage is not an authentication failure.
      return res.status(503).json({ message: "Authentication temporarily unavailable" });
    }
  };
}

export const requireAuth = createRequireAuth();
