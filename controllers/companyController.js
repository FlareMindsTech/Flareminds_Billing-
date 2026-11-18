import mongoose from "mongoose";
import Company from "../models/Company.js";
import Client from "../models/Client.js";
import Invoice from "../models/Invoice.js";
import Quotation from "../models/Quotation.js";
import { audit } from "../utils/auditLog.js";
import { ensureDefaultTemplates } from "../services/templateService.js";
import { isValidEmail } from "../utils/validation.js";
import { stateCodeForName } from "../utils/indianStates.js";
import { resolveStateCode, normalizeGstin } from "../utils/gst.js";

const COMPANY_FIELDS = [
  "name",
  "code",
  "tagline",
  "address",
  "phone",
  "email",
  "website",
  "gstn",
  "state",
  "stateCode",
  "defaultHsnSac",
  "logoIconUrl",
  "logoTextUrl",
  "invoicePrefix",
  "quotationPrefix",
  "currency",
  "defaultTaxPercent",
  "defaultHsnSac",
  "taxRates",
  "gstRegistered",
  "defaultInvoiceNotes",
  "defaultQuotationNotes",
  "defaultTermsAndConditions",
  "defaultPaymentTerms",
  "defaultDeliveryTimeline",
  "defaultWarrantyTerms",
  "defaultExclusions",
  "signatoryName",
  "signatoryTitle",
  "isActive",
  "isDefault",
];

const BANK_FIELDS = ["bankName", "accountName", "accountNumber", "ifsc", "branch", "upi"];
const TEXT_FIELDS = [
  "tagline",
  "address",
  "phone",
  "email",
  "website",
  "gstn",
  "state",
  "stateCode",
  "defaultHsnSac",
  "logoIconUrl",
  "logoTextUrl",
  "defaultInvoiceNotes",
  "defaultQuotationNotes",
  "defaultTermsAndConditions",
  "defaultPaymentTerms",
  "defaultDeliveryTimeline",
  "defaultWarrantyTerms",
  "defaultExclusions",
  "signatoryName",
  "signatoryTitle",
];

const LABEL_FIELDS = [
  "quotationTitle",
  "invoiceTitle",
  "clientSectionTitle",
  "itemDescriptionLabel",
  "itemCategoryLabel",
  "itemUnitLabel",
  "itemQuantityLabel",
  "itemRateLabel",
  "itemDiscountLabel",
  "itemTaxLabel",
  "itemAmountLabel",
  "subTotalLabel",
  "taxTotalLabel",
  "grandTotalLabel",
  "notesLabel",
  "termsLabel",
];

const isBadId = (id) => !mongoose.isValidObjectId(id);

export function pickCompanyFields(body = {}) {
  const data = {};
  for (const field of COMPANY_FIELDS) {
    if (body[field] !== undefined) data[field] = body[field];
  }

  if (body.bank && typeof body.bank === "object" && !Array.isArray(body.bank)) {
    data.bank = {};
    for (const field of BANK_FIELDS) {
      if (body.bank[field] !== undefined) data.bank[field] = body.bank[field];
    }
  }

  if (body.customLabels && typeof body.customLabels === "object" && !Array.isArray(body.customLabels)) {
    data.customLabels = {};
    for (const field of LABEL_FIELDS) {
      if (body.customLabels[field] !== undefined) {
        data.customLabels[field] = String(body.customLabels[field] || "").trim();
      }
    }
  }

  if (Array.isArray(body.customFields)) {
    data.customFields = body.customFields;
  }

  if (Array.isArray(body.itemCustomFields)) {
    data.itemCustomFields = body.itemCustomFields;
  }

  return data;
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function codeFromName(name) {
  const base = String(name || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 15);
  return base || "COMPANY";
}

export async function uniqueCode(name) {
  const base = codeFromName(name);
  let code = base;
  let suffix = 2;
  while (await Company.exists({ code })) {
    code = `${base}-${suffix}`;
    suffix += 1;
  }
  return code;
}

export function validateCustomFields(fields, isItem = false) {
  if (!Array.isArray(fields)) return null;
  const prefix = isItem ? "Item custom" : "Custom";
  const validTypes = isItem ? ["text", "number", "select"] : ["text", "number", "date", "select", "boolean"];

  const keys = new Set();
  for (const [index, field] of fields.entries()) {
    if (!field || typeof field !== "object" || Array.isArray(field)) {
      return `${prefix} field definition ${index + 1} is invalid.`;
    }
    const key = String(field.key || "").trim();
    if (!key || !/^[A-Za-z0-9_-]{1,60}$/.test(key)) {
      return `${prefix} field ${index + 1} requires a valid alphanumeric key (1-60 chars).`;
    }
    if (keys.has(key)) {
      return `Duplicate ${prefix.toLowerCase()} field key: "${key}".`;
    }
    keys.add(key);

    const label = String(field.label || "").trim();
    if (!label) {
      return `${prefix} field "${key}" requires a label.`;
    }

    const type = field.type || "text";
    if (!validTypes.includes(type)) {
      return `${prefix} field "${key}" has invalid type "${type}".`;
    }

    if (type === "select" && (!Array.isArray(field.options) || field.options.length === 0)) {
      return `${prefix} field "${key}" of type "select" requires an options array.`;
    }
  }
  return null;
}

export function validateCompany(data, { creating = false } = {}) {
  if (data.name !== undefined || creating) {
    if (typeof data.name !== "string" || !data.name.trim()) return "Company name is required.";
    if (data.name.trim().length < 2) return "Company name must be at least 2 characters.";
    if (data.name.trim().length > 150) return "Company name is too long.";
  }

  if (data.code !== undefined) {
    const code = normalizeCode(data.code);
    if (!/^[A-Z0-9-]{2,20}$/.test(code)) {
      return "Company code must be 2-20 letters, numbers or hyphens.";
    }
    data.code = code;
  }

  for (const field of ["invoicePrefix", "quotationPrefix"]) {
    if (data[field] !== undefined) {
      const value = normalizeCode(data[field]);
      if (!/^[A-Z0-9-]{1,20}$/.test(value)) {
        return `${field} must be 1-20 letters, numbers or hyphens.`;
      }
      data[field] = value;
    }
  }

  if (data.currency !== undefined) {
    const currency = normalizeCode(data.currency);
    if (!/^[A-Z]{3,8}$/.test(currency)) {
      return "Currency must be a 3-8 letter code (e.g. INR).";
    }
    data.currency = currency;
  }

  if (data.defaultTaxPercent !== undefined) {
    const tax = Number(data.defaultTaxPercent);
    if (!Number.isFinite(tax) || tax < 0 || tax > 100) {
      return "Default tax percent must be between 0 and 100.";
    }
    data.defaultTaxPercent = tax;
  }

  if (data.state !== undefined || data.stateCode !== undefined) {
    const state = (data.state ?? "").trim();
    const code = (data.stateCode ?? "").trim().toUpperCase();
    if (code && !/^[0-9]{2}$/.test(code)) {
      return "GST state code must be 2 digits.";
    }
    if (state && code) {
      const expected = stateCodeForName(state);
      if (expected && expected !== code) {
        return "State and GST state code do not match.";
      }
    }
    if (state && !code) {
      const expected = stateCodeForName(state);
      if (expected) data.stateCode = expected;
    }
  }

  if (data.gstn !== undefined && !data.stateCode) {
    const normalized = normalizeGstin(data.gstn);
    if (normalized) {
      const derived = resolveStateCode({ gstn: normalized });
      if (derived) data.stateCode = derived;
    }
  }

  if (data.taxRates !== undefined) {
    if (!Array.isArray(data.taxRates)) {
      return "Tax rates must be a list.";
    }
    const normalized = [];
    const seen = new Set();
    for (const raw of data.taxRates) {
      const rate = Number(raw);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
        return "Each tax rate must be between 0 and 100.";
      }
      if (seen.has(rate)) continue;
      seen.add(rate);
      normalized.push(rate);
    }
    data.taxRates = normalized.sort((a, b) => a - b);
  }

  if (data.gstRegistered !== undefined && typeof data.gstRegistered !== "boolean") {
    return "GST registered must be a boolean.";
  }

  if (data.email !== undefined && data.email !== "" && !isValidEmail(data.email)) {
    return "Enter a valid company email address.";
  }

  for (const field of TEXT_FIELDS) {
    if (data[field] !== undefined && typeof data[field] !== "string") {
      return `${field} must be text.`;
    }
  }

  if (data.logoIconUrl !== undefined && data.logoIconUrl.length > 500000) {
    return "Logo icon is too large.";
  }
  if (data.logoTextUrl !== undefined && data.logoTextUrl.length > 500000) {
    return "Logo text image is too large.";
  }

  if (data.bank !== undefined) {
    for (const field of BANK_FIELDS) {
      if (data.bank[field] !== undefined && typeof data.bank[field] !== "string") {
        return `Bank ${field} must be text.`;
      }
    }
  }

  if (data.customFields !== undefined) {
    const customFieldsErr = validateCustomFields(data.customFields, false);
    if (customFieldsErr) return customFieldsErr;
  }

  if (data.itemCustomFields !== undefined) {
    const itemFieldsErr = validateCustomFields(data.itemCustomFields, true);
    if (itemFieldsErr) return itemFieldsErr;
  }

  for (const field of ["isActive", "isDefault", "gstRegistered"]) {
    if (data[field] !== undefined && typeof data[field] !== "boolean") {
      return `${field} must be a boolean.`;
    }
  }

  return null;
}

export const listCompanies = async (req, res) => {
  // Company admins only ever see their own company. Superadmins see all.
  if (req.admin?.role !== "superadmin" && !req.admin?.companyId) {
    return res.json([]);
  }
  const filter =
    req.admin?.role === "superadmin" ? {} : { _id: req.admin?.companyId };
  const companies = await Company.find(filter).sort({ isDefault: -1, createdAt: 1 });
  res.json(companies);
};

export const getCurrentCompany = async (req, res) => {
  if (req.company?.code) {
    return res.json(req.company);
  }
  const targetId = req.companyId || req.admin?.companyId || req.company?._id;
  if (targetId) {
    const company = await Company.findById(targetId);
    if (company) return res.json(company);
  }

  // Non-superadmins must never fall back to the platform default company
  if (req.admin && req.admin.role !== "superadmin") {
    return res.status(404).json({ message: "No active company configured" });
  }

  const defaultCompany =
    (await Company.findOne({ isDefault: true })) ||
    (await Company.findOne({ status: "active" }).sort({ createdAt: 1 }));

  if (!defaultCompany) {
    return res.status(404).json({ message: "No active company configured" });
  }
  res.json(defaultCompany);
};

export const getCompany = async (req, res) => {
  if (isBadId(req.params.id)) return res.status(404).json({ message: "Company not found" });
  if (
    req.admin?.role !== "superadmin" &&
    String(req.admin?.companyId) !== String(req.params.id)
  ) {
    return res.status(403).json({ message: "You can only access your own company" });
  }

  const company = await Company.findById(req.params.id);
  if (!company) return res.status(404).json({ message: "Company not found" });
  res.json(company);
};

export const createCompany = async (req, res) => {
  try {
    const data = pickCompanyFields(req.body);
    const validationError = validateCompany(data, { creating: true });
    if (validationError) return res.status(400).json({ message: validationError });

    data.name = data.name.trim();

    const companyCount = await Company.countDocuments();
    const makeDefault = companyCount === 0 || data.isDefault === true;

    if (makeDefault && data.isActive === false) {
      return res.status(400).json({ message: "The default company must be active." });
    }

    if (data.code !== undefined) {
      const duplicate = await Company.exists({ code: data.code });
      if (duplicate) return res.status(409).json({ message: "Company code is already in use." });
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

    const company = await Company.create(data);
    await ensureDefaultTemplates(company._id, req.admin?.id || null);

    audit("company_created", {
      actor: req.admin?.email,
      companyId: String(company._id),
      code: company.code,
    });

    res.status(201).json(company);
  } catch (err) {
    const duplicate = err?.code === 11000;
    const status = duplicate ? 409 : err.name === "ValidationError" ? 400 : 500;
    res.status(status).json({
      message: duplicate
        ? "Company code is already in use."
        : status === 400
          ? err.message
          : "Failed to create company",
    });
  }
};

export const updateCompany = async (req, res) => {
  try {
    if (isBadId(req.params.id)) return res.status(404).json({ message: "Company not found" });

    const company = await Company.findById(req.params.id);
    if (!company) return res.status(404).json({ message: "Company not found" });

    const data = pickCompanyFields(req.body);
    const validationError = validateCompany(data);
    if (validationError) return res.status(400).json({ message: validationError });

    if (data.code !== undefined && data.code !== company.code) {
      const duplicate = await Company.exists({ code: data.code, _id: { $ne: company._id } });
      if (duplicate) return res.status(409).json({ message: "Company code is already in use." });
    }

    if (data.isDefault === false && company.isDefault) {
      return res.status(409).json({
        message: "Choose another default company before clearing this one.",
      });
    }

    if (data.isActive === false && company.isDefault) {
      return res.status(409).json({ message: "The default company must remain active." });
    }

    if (data.name !== undefined) data.name = data.name.trim();

    const bank = data.bank;
    delete data.bank;

    const customLabels = data.customLabels;
    delete data.customLabels;

    if (data.isDefault === true && !company.isDefault) {
      await Company.updateMany({ _id: { $ne: company._id } }, { $set: { isDefault: false } });
    }

    Object.assign(company, data);
    if (bank) {
      company.bank = { ...(company.bank?.toObject?.() || company.bank || {}), ...bank };
    }
    if (customLabels) {
      company.customLabels = { ...(company.customLabels?.toObject?.() || company.customLabels || {}), ...customLabels };
    }

    await company.save();

    audit("company_updated", {
      actor: req.admin?.email,
      companyId: String(company._id),
      fields: Object.keys(data).concat(bank ? ["bank"] : []).concat(customLabels ? ["customLabels"] : []),
    });

    res.json(company);
  } catch (err) {
    const duplicate = err?.code === 11000;
    const status = duplicate ? 409 : err.name === "ValidationError" ? 400 : 500;
    res.status(status).json({
      message: duplicate
        ? "Company code is already in use."
        : status === 400
          ? err.message
          : "Failed to update company",
    });
  }
};

export const setDefaultCompany = async (req, res) => {
  if (isBadId(req.params.id)) return res.status(404).json({ message: "Company not found" });

  const company = await Company.findById(req.params.id);
  if (!company) return res.status(404).json({ message: "Company not found" });
  if (company.status === "suspended" || company.isActive === false) {
    return res.status(409).json({ message: "An inactive company cannot be the default." });
  }

  if (!company.isDefault) {
    await Company.updateMany({ _id: { $ne: company._id } }, { $set: { isDefault: false } });
    company.isDefault = true;
    await company.save();

    audit("company_set_default", {
      actor: req.admin?.email,
      companyId: String(company._id),
      code: company.code,
    });
  }

  res.json(company);
};

export const deleteCompany = async (req, res) => {
  if (isBadId(req.params.id)) return res.status(404).json({ message: "Company not found" });

  const company = await Company.findById(req.params.id);
  if (!company) return res.status(404).json({ message: "Company not found" });

  if (company.isDefault) {
    return res.status(409).json({ message: "The default company cannot be deleted." });
  }

  if ((await Company.countDocuments()) <= 1) {
    return res.status(409).json({ message: "At least one company must exist." });
  }

  // Use companyId to accurately check scoped records
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

  await Company.findByIdAndDelete(company._id);

  audit("company_deleted", {
    actor: req.admin?.email,
    companyId: String(company._id),
    code: company.code,
  });

  res.json({ message: "Company deleted" });
};

// ---------------------------------------------------------------------------
// Tenant-scoped company settings (company admin only)
// ---------------------------------------------------------------------------

const TENANT_EDITABLE_FIELDS = new Set([
  "name",
  "tagline",
  "address",
  "phone",
  "email",
  "website",
  "gstn",
  "state",
  "stateCode",
  "defaultHsnSac",
  "logoIconUrl",
  "logoTextUrl",
  "invoicePrefix",
  "quotationPrefix",
  "currency",
  "defaultTaxPercent",
  "defaultHsnSac",
  "taxRates",
  "gstRegistered",
  "defaultInvoiceNotes",
  "defaultQuotationNotes",
  "defaultTermsAndConditions",
  "defaultPaymentTerms",
  "defaultDeliveryTimeline",
  "defaultWarrantyTerms",
  "defaultExclusions",
  "signatoryName",
  "signatoryTitle",
  "bank",
  "customLabels",
  "customFields",
  "itemCustomFields",
]);

export const getMyCompany = async (req, res) => {
  const companyId = req.admin?.companyId || req.companyId;
  if (!companyId) {
    return res.status(403).json({ message: "No company is assigned to this account" });
  }
  const company = await Company.findById(companyId);
  if (!company) return res.status(404).json({ message: "Company not found" });
  res.json(company);
};

export const updateMyCompany = async (req, res) => {
  try {
    const companyId = req.admin?.companyId || req.companyId;
    if (!companyId) {
      return res.status(403).json({ message: "No company is assigned to this account" });
    }

    const company = await Company.findById(companyId);
    if (!company) return res.status(404).json({ message: "Company not found" });

    const picked = pickCompanyFields(req.body);
    const data = {};
    for (const [key, value] of Object.entries(picked)) {
      if (TENANT_EDITABLE_FIELDS.has(key)) data[key] = value;
    }

    const validationError = validateCompany(data);
    if (validationError) return res.status(400).json({ message: validationError });

    if (data.name !== undefined) data.name = data.name.trim();

    const bank = data.bank;
    delete data.bank;
    const customLabels = data.customLabels;
    delete data.customLabels;

    Object.assign(company, data);
    if (bank) {
      company.bank = {
        ...(company.bank?.toObject?.() || company.bank || {}),
        ...bank,
      };
    }
    if (customLabels) {
      company.customLabels = {
        ...(company.customLabels?.toObject?.() || company.customLabels || {}),
        ...customLabels,
      };
    }

    await company.save();

    audit("company_settings_updated", {
      actor: req.admin?.email,
      companyId: String(company._id),
      fields: Object.keys(data)
        .concat(bank ? ["bank"] : [])
        .concat(customLabels ? ["customLabels"] : []),
    });

    res.json(company);
  } catch (err) {
    const status = err.name === "ValidationError" ? 400 : 500;
    res.status(status).json({
      message: status === 400 ? err.message : "Failed to update company settings",
    });
  }
};