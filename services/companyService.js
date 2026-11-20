import Company from "../models/Company.js";
import Client from "../models/Client.js";
import Invoice from "../models/Invoice.js";
import Quotation from "../models/Quotation.js";
import { ensureDefaultTemplates } from "./templateService.js";

export const DEFAULT_COMPANY_CODE = "DEFAULT";

// Seeds a company from the pre-multi-company environment variables so an
// existing deployment keeps its branding and bank details without a manual
// migration step.
export function companyFromEnv(env = process.env) {
  return {
    name: env.COMPANY_NAME || "FlareMinds Technology and Services",
    code: DEFAULT_COMPANY_CODE,
    tagline: env.COMPANY_TAGLINE || "",
    address: env.COMPANY_ADDRESS || "",
    phone: env.COMPANY_PHONE || "",
    email: env.COMPANY_EMAIL || "",
    website: env.COMPANY_WEBSITE || "",
    gstn: env.COMPANY_GSTN || "",
    logoIconUrl: env.COMPANY_LOGO_ICON_URL || "",
    logoTextUrl: env.COMPANY_LOGO_TEXT_URL || "",
    invoicePrefix: env.INVOICE_PREFIX || "FM",
    quotationPrefix: env.QUOTATION_PREFIX || "FM-QTN",
    currency: env.DEFAULT_CURRENCY || "INR",
    defaultTaxPercent: Number(env.DEFAULT_TAX_PERCENT) || 0,
    defaultInvoiceNotes: env.INVOICE_NOTES || "",
    defaultQuotationNotes: env.QUOTATION_NOTES || "",
    defaultTermsAndConditions: env.QUOTATION_TERMS || "",
    defaultPaymentTerms: env.QUOTATION_PAYMENT_TERMS || "",
    defaultDeliveryTimeline: env.QUOTATION_DELIVERY_TIMELINE || "",
    defaultWarrantyTerms: env.QUOTATION_WARRANTY_TERMS || "",
    defaultExclusions: env.QUOTATION_EXCLUSIONS || "",
    bank: {
      accountName: env.BANK_NAME || "",
      accountNumber: env.BANK_ACC_NO || "",
      ifsc: env.BANK_IFSC || "",
      branch: env.BANK_BRANCH || "",
      upi: env.BANK_UPI || "",
    },
    customFields: [],
    itemCustomFields: [],
    customLabels: {
      quotationTitle: "QUOTATION",
      invoiceTitle: "TAX INVOICE",
      clientSectionTitle: "QUOTATION FOR",
      itemDescriptionLabel: "Description",
      itemCategoryLabel: "Category",
      itemUnitLabel: "Unit",
      itemQuantityLabel: "Qty",
      itemRateLabel: "Rate",
      itemDiscountLabel: "Discount",
      itemTaxLabel: "Tax",
      itemAmountLabel: "Amount",
      subTotalLabel: "Sub Total",
      taxTotalLabel: "Tax",
      grandTotalLabel: "Grand Total",
      notesLabel: "Notes",
      termsLabel: "Terms & Conditions",
    },
    status: "active",
    isActive: true,
    isDefault: true,
  };
}

async function createDefaultCompany() {
  const payload = companyFromEnv();
  try {
    return await Company.create(payload);
  } catch (err) {
    // A second process may have created the default company concurrently.
    if (err?.code === 11000) {
      const existing = await Company.findOne({ code: DEFAULT_COMPANY_CODE });
      if (existing) return existing;
    }
    throw err;
  }
}

// Guarantees there is always a default company and assigns legacy records
// (created before multi-company support) to it. Safe to run on every startup.
export async function ensureDefaultCompany() {
  // Do not auto-create a company for a clean multi-tenant deployment.
  // Legacy records are only backfilled when a company already exists.
  let company = await Company.findOne({ isDefault: true });

  if (!company) {
    const oldest = await Company.findOne().sort({ createdAt: 1 });
    if (oldest) {
      oldest.isDefault = true;
      if (!oldest.invoicePrefix) oldest.invoicePrefix = "FM";
      if (!oldest.quotationPrefix) oldest.quotationPrefix = "FM-QTN";
      company = await oldest.save();
    }
  }

  if (!company) {
    return null;
  }

  // Use companyId to avoid colliding with client's business name string
  const missingCompany = {
    $or: [{ companyId: { $exists: false } }, { companyId: null }],
  };

  await Promise.all([
    Client.updateMany(missingCompany, { $set: { companyId: company._id } }),
    Invoice.updateMany(missingCompany, { $set: { companyId: company._id } }),
    Quotation.updateMany(missingCompany, { $set: { companyId: company._id } }),
  ]);

  await ensureDefaultTemplates(company._id).catch(() => {});

  return company;
}
