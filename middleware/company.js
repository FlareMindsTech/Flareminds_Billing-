import mongoose from "mongoose";
import Company from "../models/Company.js";
import { isCompanyActive } from "../utils/companyStatus.js";

// Resolves the active company for every scoped request.
// - Company admins are hard-locked to their own company; any other
//   X-Company-Id/query/body value is rejected.
// - Superadmins may target any explicitly selected active company.
export async function resolveCompany(req, res, next) {
  const rawId =
    req.get("x-company-id") ||
    req.query.companyId ||
    req.body?.companyId;

  const requestedId = typeof rawId === "string" ? rawId.trim() : "";

  if (req.admin && req.admin.role !== "superadmin") {
    if (!req.admin.companyId) {
      return res.status(403).json({ message: "No company is assigned to this account" });
    }

    if (requestedId && requestedId !== String(req.admin.companyId)) {
      return res.status(403).json({ message: "You can only access your own company" });
    }

    const company = await Company.findById(req.admin.companyId);
    if (!company) {
      return res.status(404).json({ message: "Company not found" });
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
    return next();
  }

  if (requestedId) {
    if (!mongoose.isValidObjectId(requestedId)) {
      return res.status(400).json({ message: "Invalid company id" });
    }

    const company = await Company.findById(requestedId);
    if (!company) {
      return res.status(404).json({ message: "Company not found" });
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
    return next();
  }

  return res.status(400).json({
    message: "A company must be selected for this operation",
  });
}

export async function requireCompany(req, res, next) {
  await resolveCompany(req, res, () => {
    if (!req.company) {
      return res.status(409).json({ message: "No active company is configured" });
    }
    next();
  });
}
