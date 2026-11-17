import Admin from "../models/Admin.js";
import Company from "../models/Company.js";
import { ensureDefaultTemplates } from "../services/templateService.js";

// Idempotent backfill for deployments created before roles, company
// suspension and DB-backed templates existed. Safe to run on every startup.
export async function migrateLegacyData({ superadminEmail } = {}) {
  const companies = await Company.find();
  for (const company of companies) {
    let changed = false;
    if (!company.status) {
      company.status = company.isActive === false ? "suspended" : "active";
      changed = true;
    }
    if (company.isActive === undefined) {
      company.isActive = company.status === "active";
      changed = true;
    }
    if (changed) await company.save();
  }

  const defaultCompany =
    (await Company.findOne({ isDefault: true })) ||
    (await Company.findOne({ status: "active" }).sort({ createdAt: 1 }));

  const normalisedSuperadmin = String(superadminEmail || "").toLowerCase();
  const admins = await Admin.find();
  for (const admin of admins) {
    let changed = false;

    if (!admin.role) {
      if (normalisedSuperadmin && admin.email === normalisedSuperadmin) {
        admin.role = "superadmin";
        admin.companyId = null;
      } else {
        admin.role = "company_admin";
        if (!admin.companyId && defaultCompany) {
          admin.companyId = defaultCompany._id;
        }
      }
      changed = true;
    }

    if (admin.role === "superadmin" && admin.companyId) {
      admin.companyId = null;
      changed = true;
    }

    if (changed) await admin.save();
  }

  for (const company of companies) {
    await ensureDefaultTemplates(company._id).catch(() => {});
  }
}
