import mongoose from "mongoose";
import Admin from "../models/Admin.js";
import Company from "../models/Company.js";
import Client from "../models/Client.js";
import Invoice from "../models/Invoice.js";
import Quotation from "../models/Quotation.js";
import DocumentTemplate from "../models/DocumentTemplate.js";
import { audit } from "../utils/auditLog.js";
import { isValidEmail } from "../utils/validation.js";
import { ensureDefaultTemplates } from "../services/templateService.js";
import {
  pickCompanyFields,
  uniqueCode,
  validateCompany,
} from "./companyController.js";

const isBadId = (id) => !mongoose.isValidObjectId(id);

function normalizeStatus(company) {
  return company.status || (company.isActive === false ? "suspended" : "active");
}

function adminSummary(admin) {
  if (!admin) return null;
  return {
    _id: String(admin._id),
    email: admin.email,
    name: admin.name,
    isActive: admin.isActive !== false,
    lastLoginAt: admin.lastLoginAt || null,
  };
}

export const listAllCompanies = async (req, res) => {
  const companies = await Company.find().sort({ isDefault: -1, createdAt: 1 }).lean();

  const companyIds = companies.map((company) => company._id);

  const [admins, clientCounts, invoiceCounts, quotationCounts] = await Promise.all([
    Admin.find({ companyId: { $in: companyIds } })
      .select("email name isActive lastLoginAt companyId")
      .lean(),
    Client.aggregate([
      { $match: { companyId: { $in: companyIds } } },
      { $group: { _id: "$companyId", count: { $sum: 1 } } },
    ]),
    Invoice.aggregate([
      { $match: { companyId: { $in: companyIds } } },
      { $group: { _id: "$companyId", count: { $sum: 1 } } },
    ]),
    Quotation.aggregate([
      { $match: { companyId: { $in: companyIds } } },
      { $group: { _id: "$companyId", count: { $sum: 1 } } },
    ]),
  ]);

  const adminMap = new Map(
    admins.map((admin) => [String(admin.companyId), adminSummary(admin)])
  );
  const countMap = (rows) =>
    new Map(rows.map((row) => [String(row._id), row.count]));

  const clients = countMap(clientCounts);
  const invoices = countMap(invoiceCounts);
  const quotations = countMap(quotationCounts);

  res.json(
    companies.map((company) => ({
      ...company,
      status: normalizeStatus(company),
      admin: adminMap.get(String(company._id)) || null,
      counts: {
        clients: clients.get(String(company._id)) || 0,
        invoices: invoices.get(String(company._id)) || 0,
        quotations: quotations.get(String(company._id)) || 0,
      },
    }))
  );
};

export const createCompanyWithAdmin = async (req, res) => {
  let company = null;
  try {
    const body = req.body || {};
    const companyInput =
      body.company && typeof body.company === "object" ? body.company : body;
    const adminInput =
      body.admin && typeof body.admin === "object" ? body.admin : {};

    const data = pickCompanyFields(companyInput);
    const validationError = validateCompany(data, { creating: true });
    if (validationError) return res.status(400).json({ message: validationError });

    const email = String(adminInput.email || "").trim().toLowerCase();
    const password = String(adminInput.password || "");
    const adminName = String(adminInput.name || "Company Admin").trim().slice(0, 100);

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ message: "A valid admin email is required" });
    }
    if (password.length < 8 || password.length > 200) {
      return res
        .status(400)
        .json({ message: "Admin password must be between 8 and 200 characters" });
    }
    if (await Admin.exists({ email })) {
      return res.status(409).json({ message: "An admin with this email already exists" });
    }

    data.name = data.name.trim();

    const companyCount = await Company.countDocuments();
    const makeDefault = companyCount === 0 || data.isDefault === true;

    if (data.code !== undefined) {
      const duplicate = await Company.exists({ code: data.code });
      if (duplicate) return res.status(409).json({ message: "Company code is already in use" });
    } else {
      data.code = await uniqueCode(data.name);
    }

    const shortCode = data.code.slice(0, 15);
    if (!data.invoicePrefix) data.invoicePrefix = shortCode;
    if (!data.quotationPrefix) data.quotationPrefix = `${shortCode}-QTN`;

    if (makeDefault) {
      await Company.updateMany({ isDefault: true }, { $set: { isDefault: false } });
    }

    data.isDefault = makeDefault;
    data.status = "active";
    data.isActive = true;
    data.createdBy = req.admin?.id || null;

    company = await Company.create(data);

    const passwordHash = await Admin.hashPassword(password);
    const admin = await Admin.create({
      email,
      passwordHash,
      name: adminName,
      role: "company_admin",
      companyId: company._id,
      createdBy: req.admin?.id || null,
    });

    await ensureDefaultTemplates(company._id, req.admin?.id || null);

    audit("company_created", {
      actor: req.admin?.email,
      companyId: String(company._id),
      code: company.code,
      adminEmail: admin.email,
    });

    res.status(201).json({
      company,
      admin: adminSummary(admin),
    });
  } catch (err) {
    // Best-effort rollback so a failed admin creation does not leave an
    // unreachable company behind.
    if (company) {
      await Company.findByIdAndDelete(company._id).catch(() => {});
      await DocumentTemplate.deleteMany({ companyId: company._id }).catch(() => {});
    }

    const duplicate = err?.code === 11000;
    return res.status(duplicate ? 409 : err.name === "ValidationError" ? 400 : 500).json({
      message: duplicate
        ? "Company code or admin email is already in use"
        : err.name === "ValidationError"
          ? err.message
          : "Failed to create company",
    });
  }
};

export const updateCompanyStatus = async (req, res) => {
  if (isBadId(req.params.id)) {
    return res.status(404).json({ message: "Company not found" });
  }

  const status = req.body?.status;
  if (!["active", "suspended"].includes(status)) {
    return res.status(400).json({ message: "Status must be active or suspended" });
  }

  const company = await Company.findById(req.params.id);
  if (!company) return res.status(404).json({ message: "Company not found" });

  if (status === "suspended" && company.isDefault) {
    return res.status(409).json({
      message: "Choose another default company before suspending this one",
    });
  }

  if (status === "suspended") {
    company.status = "suspended";
    company.isActive = false;
    company.suspendedAt = new Date();
    company.suspendedReason = String(req.body?.reason || "").trim().slice(0, 500);
    company.suspendedBy = req.admin?.id || null;
  } else {
    company.status = "active";
    company.isActive = true;
    company.suspendedAt = null;
    company.suspendedReason = "";
    company.suspendedBy = null;
  }

  await company.save();

  audit(status === "suspended" ? "company_suspended" : "company_reactivated", {
    actor: req.admin?.email,
    companyId: String(company._id),
    code: company.code,
    reason: company.suspendedReason,
  });

  res.json(company);
};

export const setDefaultCompanyAdmin = async (req, res) => {
  if (isBadId(req.params.id)) {
    return res.status(404).json({ message: "Company not found" });
  }

  const company = await Company.findById(req.params.id);
  if (!company) return res.status(404).json({ message: "Company not found" });
  if (normalizeStatus(company) !== "active") {
    return res.status(409).json({ message: "A suspended company cannot be the default" });
  }

  if (!company.isDefault) {
    await Company.updateMany(
      { _id: { $ne: company._id } },
      { $set: { isDefault: false } }
    );
    company.isDefault = true;
    await company.save();
  }

  audit("company_set_default", {
    actor: req.admin?.email,
    companyId: String(company._id),
    code: company.code,
  });

  res.json(company);
};

export const resetCompanyAdminPassword = async (req, res) => {
  if (isBadId(req.params.id)) {
    return res.status(404).json({ message: "Company not found" });
  }

  const password = String(req.body?.password || "");
  if (password.length < 8 || password.length > 200) {
    return res
      .status(400)
      .json({ message: "Password must be between 8 and 200 characters" });
  }

  const admin = await Admin.findOne({ companyId: req.params.id });
  if (!admin) {
    return res.status(404).json({ message: "This company has no admin account" });
  }

  const email = req.body?.email !== undefined ? String(req.body.email).trim().toLowerCase() : null;
  if (email !== null) {
    if (!isValidEmail(email)) {
      return res.status(400).json({ message: "Enter a valid email address" });
    }
    if (email !== admin.email && (await Admin.exists({ email, _id: { $ne: admin._id } }))) {
      return res.status(409).json({ message: "An admin with this email already exists" });
    }
    admin.email = email;
  }

  if (req.body?.name !== undefined) {
    admin.name = String(req.body.name).trim().slice(0, 100) || admin.name;
  }
  if (req.body?.isActive !== undefined) {
    admin.isActive = Boolean(req.body.isActive);
  }

  admin.passwordHash = await Admin.hashPassword(password);
  await admin.save();

  audit("company_admin_password_reset", {
    actor: req.admin?.email,
    companyId: String(req.params.id),
    adminEmail: admin.email,
  });

  res.json({ admin: adminSummary(admin) });
};

export const deleteCompanyPermanently = async (req, res) => {
  if (isBadId(req.params.id)) {
    return res.status(404).json({ message: "Company not found" });
  }

  const company = await Company.findById(req.params.id);
  if (!company) return res.status(404).json({ message: "Company not found" });

  if (company.isDefault) {
    return res.status(409).json({ message: "The default company cannot be deleted" });
  }
  if ((await Company.countDocuments()) <= 1) {
    return res.status(409).json({ message: "At least one company must exist" });
  }

  const [clientCount, invoiceCount, quotationCount] = await Promise.all([
    Client.countDocuments({ companyId: company._id }),
    Invoice.countDocuments({ companyId: company._id }),
    Quotation.countDocuments({ companyId: company._id }),
  ]);

  if (clientCount + invoiceCount + quotationCount > 0) {
    return res.status(409).json({
      message:
        `This company still has ${clientCount} client(s), ${invoiceCount} invoice(s) ` +
        `and ${quotationCount} quotation(s). Delete those records first.`,
    });
  }

  await Promise.all([
    DocumentTemplate.deleteMany({ companyId: company._id }),
    Admin.deleteMany({ companyId: company._id }),
    Company.findByIdAndDelete(company._id),
  ]);

  audit("company_deleted", {
    actor: req.admin?.email,
    companyId: String(company._id),
    code: company.code,
  });

  res.json({ message: "Company deleted" });
};

export const getPlatformOverview = async (req, res) => {
  const companies = await Company.find()
    .select("name code status isActive isDefault createdAt")
    .sort({ createdAt: 1 })
    .lean();

  const companyIds = companies.map((company) => company._id);

  const [admins, clientRows, invoiceRows, quotationRows] = await Promise.all([
    Admin.find({ role: "company_admin", companyId: { $in: companyIds } })
      .select("companyId isActive lastLoginAt")
      .lean(),
    Client.aggregate([
      { $match: { companyId: { $in: companyIds } } },
      { $group: { _id: "$companyId", count: { $sum: 1 } } },
    ]),
    Invoice.aggregate([
      { $match: { companyId: { $in: companyIds } } },
      {
        $group: {
          _id: { companyId: "$companyId", status: "$status" },
          count: { $sum: 1 },
          value: { $sum: "$grandTotal" },
        },
      },
    ]),
    Quotation.aggregate([
      { $match: { companyId: { $in: companyIds } } },
      {
        $group: {
          _id: { companyId: "$companyId", status: "$status" },
          count: { $sum: 1 },
          value: { $sum: "$grandTotal" },
        },
      },
    ]),
  ]);

  const adminByCompany = new Map();
  for (const admin of admins) {
    adminByCompany.set(String(admin.companyId), admin);
  }

  const clientsByCompany = new Map(
    clientRows.map((row) => [String(row._id), row.count])
  );

  const invoiceByCompany = new Map();
  const invoiceTotals = {
    count: 0,
    paidCount: 0,
    paidValue: 0,
    outstandingCount: 0,
    outstandingValue: 0,
    totalValue: 0,
  };
  for (const row of invoiceRows) {
    const key = String(row._id.companyId);
    if (!invoiceByCompany.has(key)) {
      invoiceByCompany.set(key, {
        count: 0,
        paidCount: 0,
        paidValue: 0,
        outstandingCount: 0,
        outstandingValue: 0,
        totalValue: 0,
      });
    }
    const entry = invoiceByCompany.get(key);
    const value = Number(row.value || 0);
    entry.count += row.count;
    entry.totalValue += value;
    invoiceTotals.count += row.count;
    invoiceTotals.totalValue += value;

    if (row._id.status === "paid") {
      entry.paidCount += row.count;
      entry.paidValue += value;
      invoiceTotals.paidCount += row.count;
      invoiceTotals.paidValue += value;
    } else if (["sent", "overdue"].includes(row._id.status)) {
      entry.outstandingCount += row.count;
      entry.outstandingValue += value;
      invoiceTotals.outstandingCount += row.count;
      invoiceTotals.outstandingValue += value;
    }
  }

  const quotationByCompany = new Map();
  const quotationTotals = { count: 0, acceptedCount: 0, acceptedValue: 0 };
  for (const row of quotationRows) {
    const key = String(row._id.companyId);
    if (!quotationByCompany.has(key)) {
      quotationByCompany.set(key, { count: 0, acceptedCount: 0, acceptedValue: 0 });
    }
    const entry = quotationByCompany.get(key);
    entry.count += row.count;
    quotationTotals.count += row.count;

    if (["accepted", "converted"].includes(row._id.status)) {
      entry.acceptedCount += row.count;
      entry.acceptedValue += Number(row.value || 0);
      quotationTotals.acceptedCount += row.count;
      quotationTotals.acceptedValue += Number(row.value || 0);
    }
  }

  const activeCompanies = companies.filter(
    (company) => normalizeStatus(company) === "active"
  ).length;
  const activeAdmins = admins.filter((admin) => admin.isActive !== false).length;

  const companyOverview = companies.map((company) => {
    const key = String(company._id);
    const admin = adminByCompany.get(key) || null;
    return {
      _id: String(company._id),
      name: company.name,
      code: company.code,
      status: normalizeStatus(company),
      isDefault: Boolean(company.isDefault),
      createdAt: company.createdAt,
      admin: adminSummary(admin),
      counts: {
        clients: clientsByCompany.get(key) || 0,
        invoices: invoiceByCompany.get(key)?.count || 0,
        quotations: quotationByCompany.get(key)?.count || 0,
      },
      invoices: invoiceByCompany.get(key) || {
        count: 0,
        paidCount: 0,
        paidValue: 0,
        outstandingCount: 0,
        outstandingValue: 0,
        totalValue: 0,
      },
      quotations: quotationByCompany.get(key) || {
        count: 0,
        acceptedCount: 0,
        acceptedValue: 0,
      },
    };
  });

  res.json({
    companies: {
      total: companies.length,
      active: activeCompanies,
      suspended: companies.length - activeCompanies,
      withAdmins: adminByCompany.size,
    },
    admins: {
      total: admins.length,
      active: activeAdmins,
    },
    clients: {
      total: clientRows.reduce((sum, row) => sum + row.count, 0),
    },
    invoices: invoiceTotals,
    quotations: quotationTotals,
    companyOverview,
    generatedAt: new Date().toISOString(),
  });
};
