import mongoose from "mongoose";
import Quotation from "../models/Quotation.js";
import Invoice from "../models/Invoice.js";
import Client from "../models/Client.js";
import Company from "../models/Company.js";
import { generateQuotationPDF } from "../services/pdfService.js";
import { sendQuotationEmail } from "../services/emailService.js";
import {
  sendQuotationWhatsApp,
  buildQuotationShareLink,
} from "../services/whatsappService.js";
import { computeQuotationTotals, roundMoney } from "../services/quotationCalculator.js";
import { nextQuotationNumber } from "../services/quotationNumber.js";
import { audit } from "../utils/auditLog.js";
import { isValidEmail } from "../utils/validation.js";
import {
  applyCustomDefaults,
  computeTotals,
  nextInvoiceNumber,
  validateCustomValues,
} from "./invoiceController.js";
import { snapshotForDocument } from "./templateController.js";

// ---------------------------------------------------------------------------
// Constants & small helpers
// ---------------------------------------------------------------------------

export const QUOTATION_STATUSES = ["draft", "sent", "accepted", "rejected", "expired", "converted"];

const EDITABLE_STATUSES = new Set(["draft"]);
const DELETABLE_STATUSES = new Set(["draft", "rejected"]);
const ACCEPTABLE_STATUSES = new Set(["draft", "sent"]);
const REJECTABLE_STATUSES = new Set(["draft", "sent"]);
const DELIVERABLE_STATUSES = new Set(["draft", "sent"]);

// Fields a client may send on create/update. numbering, totals, status,
// sentLog, acceptance data and conversion identifiers are always server-owned.
const QUOTATION_WRITABLE_FIELDS = [
  "client",
  "issueDate",
  "validUntil",
  "lineItems",
  "shippingCharges",
  "currency",
  "notes",
  "termsAndConditions",
  "deliveryTimeline",
  "paymentTerms",
  "warrantyTerms",
  "exclusions",
  "customFields",
  "templateId",
];

const isBadId = (id) => !mongoose.isValidObjectId(id);

const tenantId = (req) => req.companyId || req.company?._id || req.admin?.companyId || null;

const round2 = roundMoney;

const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

// Parses a number from a request field; null when the value is not finite.
const parseNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const startOfToday = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
};

const endOfDay = (date) => {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
};

// A quotation counts as expired once validUntil is in the past (local server day).
const isExpiredNow = (quotation) =>
  new Date(quotation.validUntil).getTime() < startOfToday().getTime();

const buildClientSnapshot = (clientDoc) => ({
  name: clientDoc?.name || "",
  company: clientDoc?.company || "",
  address: clientDoc?.address || "",
  email: clientDoc?.email || "",
  whatsapp: clientDoc?.whatsapp || "",
  phone: clientDoc?.phone || "",
  gstn: clientDoc?.gstn || "",
});

const safeMoney = (value) => round2(value);

const sanitizeDeliveryError = (err) =>
  String(err?.message || "Delivery failed")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .slice(0, 300);

const deliveryIsExpired = (quotation) => isExpiredNow(quotation);

// Validates and normalizes quotation line items.
function validateQuotationItems(rawItems, itemFieldDefs = []) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { error: "Quotation must have at least one line item" };
  }
  if (rawItems.length > 200) {
    return { error: "Quotation cannot have more than 200 line items" };
  }

  const items = [];

  for (const [index, item] of rawItems.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { error: `Line item ${index + 1} is invalid` };
    }

    const description = typeof item.description === "string" ? item.description.trim() : "";
    if (!description) return { error: `Line item ${index + 1} needs a description` };
    if (description.length > 2000) {
      return { error: `Line item ${index + 1} description is too long` };
    }

    const category = typeof item.category === "string" && item.category.trim()
      ? item.category.trim()
      : "other";
    if (category.length > 100) {
      return { error: `Line item ${index + 1} category is too long` };
    }

    const itemType = typeof item.itemType === "string" ? item.itemType.trim() : "";
    if (itemType.length > 100) {
      return { error: `Line item ${index + 1} item type is too long` };
    }

    const unit = typeof item.unit === "string" && item.unit.trim() ? item.unit.trim() : "unit";
    if (unit.length > 50) {
      return { error: `Line item ${index + 1} unit is too long` };
    }

    const quantity = parseNumber(item.quantity);
    if (quantity === null || quantity <= 0) {
      return { error: `Line item ${index + 1} quantity must be a positive number` };
    }
    if (quantity > 1e9) {
      return { error: `Line item ${index + 1} quantity is too large` };
    }

    const unitPrice = parseNumber(item.unitPrice);
    if (unitPrice === null || unitPrice < 0) {
      return { error: `Line item ${index + 1} unit price must be a number greater than or equal to 0` };
    }
    if (unitPrice > 1e12) {
      return { error: `Line item ${index + 1} unit price is too large` };
    }

    const discountType = item.discountType === undefined ? "none" : item.discountType;
    if (!["none", "percent", "amount"].includes(discountType)) {
      return { error: `Line item ${index + 1} discount type is invalid` };
    }

    const discountValue = parseNumber(item.discountValue ?? (discountType === "none" ? 0 : undefined));
    if (discountValue === null || discountValue < 0) {
      return { error: `Line item ${index + 1} discount value must be a number greater than or equal to 0` };
    }
    if (discountType === "percent" && discountValue > 100) {
      return { error: `Line item ${index + 1} percentage discount cannot exceed 100%` };
    }

    const taxPercent = parseNumber(item.taxPercent ?? 0);
    if (taxPercent === null || taxPercent < 0 || taxPercent > 100) {
      return { error: `Line item ${index + 1} tax percent must be between 0 and 100` };
    }

    const itemCustomFields =
      item.customFields && typeof item.customFields === "object" && !Array.isArray(item.customFields)
        ? item.customFields
        : {};

    if (itemFieldDefs.length > 0) {
      const { error: customErr } = validateCustomValues(
        itemCustomFields,
        itemFieldDefs,
        `Line item ${index + 1} custom`
      );
      if (customErr) return { error: customErr };
    }

    items.push({
      description,
      category,
      itemType,
      unit,
      quantity,
      unitPrice,
      discountType,
      discountValue,
      taxPercent,
      customFields: itemCustomFields,
    });
  }

  return { error: null, items };
}

async function resolveQuotationCompany(quotation, req) {
  if (quotation.companyId) {
    const comp = await Company.findById(quotation.companyId);
    if (comp) return comp;
  }
  return req?.company || null;
}

// Parses the writable body fields; returns { error, values }.
async function parseWritableBody(body, req, { forUpdate = false } = {}) {
  const raw = body || {};
  const values = {};

  for (const key of QUOTATION_WRITABLE_FIELDS) {
    if (raw[key] !== undefined) values[key] = raw[key];
  }

  if (values.client !== undefined) {
    if (typeof values.client !== "string" || isBadId(values.client)) {
      return { error: { status: 400, message: "A valid client is required" } };
    }
  } else if (!forUpdate) {
    return { error: { status: 400, message: "A valid client is required" } };
  }

  if (values.templateId !== undefined) {
    if (typeof values.templateId !== "string" || isBadId(values.templateId)) {
      return { error: { status: 400, message: "Invalid template id" } };
    }
  }

  if (values.issueDate !== undefined) {
    const parsed = parseDate(values.issueDate);
    if (!parsed) return { error: { status: 400, message: "Issue date is not a valid date" } };
    if (parsed.getTime() > Date.now()) {
      return { error: { status: 400, message: "Issue date cannot be in the future" } };
    }
    values.issueDate = parsed;
  }

  if (values.validUntil !== undefined) {
    const parsed = parseDate(values.validUntil);
    if (!parsed) return { error: { status: 400, message: "Valid-until date is not a valid date" } };
    if (parsed.getTime() < startOfToday().getTime()) {
      return { error: { status: 400, message: "Valid-until date cannot be in the past" } };
    }
    values.validUntil = parsed;
  }

  if (values.customFields !== undefined) {
    if (
      typeof values.customFields !== "object" ||
      Array.isArray(values.customFields) ||
      values.customFields === null
    ) {
      return { error: { status: 400, message: "Custom fields must be an object" } };
    }
  }

  if (values.lineItems !== undefined) {
    const { error, items } = validateQuotationItems(values.lineItems, []);
    if (error) return { error: { status: 400, message: error } };
    values._validatedItems = items;
  }

  if (values.shippingCharges !== undefined) {
    const shipping = parseNumber(values.shippingCharges);
    if (shipping === null || shipping < 0) {
      return { error: { status: 400, message: "Shipping charges must be a number greater than or equal to 0" } };
    }
    if (shipping > 1e9) {
      return { error: { status: 400, message: "Shipping charges are too large" } };
    }
    values.shippingCharges = shipping;
  }

  if (values.currency !== undefined) {
    if (typeof values.currency !== "string" || !/^[A-Za-z]{3}$/.test(values.currency.trim())) {
      return { error: { status: 400, message: "Currency must be a 3-letter code (e.g. INR)" } };
    }
    values.currency = values.currency.trim().toUpperCase();
  }

  for (const key of ["notes", "termsAndConditions", "deliveryTimeline", "paymentTerms", "warrantyTerms", "exclusions"]) {
    if (values[key] !== undefined) {
      if (typeof values[key] !== "string") {
        return { error: { status: 400, message: `${key} must be text` } };
      }
      values[key] = values[key].trim();
    }
  }

  return { error: null, values };
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export const listQuotations = async (req, res) => {
  const { status, client, search, issueFrom, issueTo } = req.query;
  const companyId = tenantId(req);
  if (!companyId) {
    return res.status(409).json({ message: "No active company is configured" });
  }

  const pageRaw = Number(req.query.page);
  const limitRaw = Number(req.query.limit);
  const page = Number.isInteger(pageRaw) && pageRaw >= 1 ? Math.min(pageRaw, 1e6) : 1;
  const limit = Number.isInteger(limitRaw) && limitRaw >= 1 ? Math.min(limitRaw, 100) : 20;

  const conditions = [{ companyId }];

  if (status !== undefined) {
    if (typeof status !== "string" || !QUOTATION_STATUSES.includes(status)) {
      return res.status(400).json({ message: "Invalid status filter" });
    }
    if (status === "expired") {
      conditions.push({
        status: { $in: ["draft", "sent"] },
        validUntil: { $lt: startOfToday() },
      });
    } else {
      conditions.push({ status });
    }
  }

  if (client !== undefined) {
    if (typeof client !== "string" || isBadId(client)) {
      return res.status(400).json({ message: "Invalid client filter" });
    }
    conditions.push({ client });
  }

  if (issueFrom !== undefined || issueTo !== undefined) {
    const range = {};
    if (issueFrom !== undefined) {
      const from = parseDate(issueFrom);
      if (!from) return res.status(400).json({ message: "Invalid issueFrom date filter" });
      range.$gte = new Date(from.setHours(0, 0, 0, 0));
    }
    if (issueTo !== undefined) {
      const to = parseDate(issueTo);
      if (!to) return res.status(400).json({ message: "Invalid issueTo date filter" });
      range.$lte = endOfDay(to);
    }
    conditions.push({ issueDate: range });
  }

  if (search !== undefined) {
    if (typeof search !== "string" || !search.trim()) {
      return res.status(400).json({ message: "Invalid search filter" });
    }
    const pattern = new RegExp(escapeRegExp(search.trim()), "i");
    const matchingClients = await Client.find({
      companyId,
      $or: [{ name: pattern }, { company: pattern }],
    }).select("_id");
    conditions.push({
      $or: [
        { quotationNumber: pattern },
        { client: { $in: matchingClients.map((c) => c._id) } },
      ],
    });
  }

  const filter =
    conditions.length === 0
      ? {}
      : conditions.length === 1
        ? conditions[0]
        : { $and: conditions };

  const today = startOfToday();
  const statsPipeline = [
    { $match: filter },
    {
      $project: {
        _id: 0,
        status: 1,
        grandTotal: 1,
        validUntil: 1,
      },
    },
    {
      $addFields: {
        effectiveStatus: {
          $cond: [
            {
              $and: [
                { $in: ["$status", ["draft", "sent"]] },
                { $lt: ["$validUntil", today] },
              ],
            },
            "expired",
            "$status",
          ],
        },
      },
    },
    {
      $group: {
        _id: "$effectiveStatus",
        count: { $sum: 1 },
        value: { $sum: "$grandTotal" },
      },
    },
  ];

  const [quotes, total, statusRows] = await Promise.all([
    Quotation.find(filter)
      .populate("client")
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Quotation.countDocuments(filter),
    Quotation.aggregate(statsPipeline),
  ]);

  const stats = {
    all: { count: total, value: 0 },
  };
  for (const st of QUOTATION_STATUSES) {
    stats[st] = { count: 0, value: 0 };
  }
  for (const row of statusRows) {
    if (stats[row._id]) {
      stats[row._id].count = row.count;
      stats[row._id].value = round2(row.value);
      stats.all.value += row.value;
    }
  }
  stats.all.value = round2(stats.all.value);

  res.json({
    data: quotes,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
    stats,
  });
};

export const getQuotation = async (req, res) => {
  const companyId = tenantId(req);
  if (!companyId) {
    return res.status(409).json({ message: "No active company is configured" });
  }
  if (isBadId(req.params.id)) {
    return res.status(404).json({ message: "Quotation not found" });
  }

  const quotation = await Quotation.findOne({
    _id: req.params.id,
    companyId,
  }).populate("client");
  if (!quotation) return res.status(404).json({ message: "Quotation not found" });
  res.json(quotation);
};

export const createQuotation = async (req, res) => {
  try {
    const companyId = tenantId(req);
    if (!companyId) {
      return res.status(409).json({ message: "No active company is configured" });
    }

    const { error, values } = await parseWritableBody(req.body, req);
    if (error) return res.status(error.status).json({ message: error.message });

    const clientId = values.client;
    const clientDoc = await Client.findOne({ _id: clientId, companyId });
    if (!clientDoc) return res.status(400).json({ message: "Client not found" });

    const activeCompany = req.company || null;

    let templateInfo = { templateId: null, templateSnapshot: null };
    if (activeCompany) {
      try {
        templateInfo = await snapshotForDocument(
          activeCompany,
          "quotation",
          values.templateId || null
        );
      } catch (err) {
        return res.status(err.status || 400).json({ message: err.message });
      }
    }

    const docFieldDefs =
      templateInfo.templateSnapshot?.customFields ||
      (activeCompany?.customFields || []).filter(
        (f) => f.appliesTo === "quotation" || f.appliesTo === "both"
      );
    const itemFieldDefs =
      templateInfo.templateSnapshot?.itemCustomFields ||
      activeCompany?.itemCustomFields ||
      [];

    const documentCustomFields = applyCustomDefaults(values.customFields, docFieldDefs);
    if (docFieldDefs.length > 0) {
      const { error: templateFieldError } = validateCustomValues(
        documentCustomFields,
        docFieldDefs,
        "Quotation custom"
      );
      if (templateFieldError) {
        return res.status(400).json({ message: templateFieldError });
      }
    }

    const normalizedLineItems = (values.lineItems || []).map((item) => ({
      ...item,
      customFields: applyCustomDefaults(item.customFields, itemFieldDefs),
    }));
    const { error: itemError, items } = validateQuotationItems(
      normalizedLineItems,
      itemFieldDefs
    );
    if (itemError) return res.status(400).json({ message: itemError });

    const issueDate = values.issueDate ?? new Date();
    const validUntil = values.validUntil;
    if (!validUntil) return res.status(400).json({ message: "Valid-until date is required" });
    if (validUntil.getTime() <= issueDate.getTime()) {
      return res.status(400).json({ message: "Valid-until date must be after the issue date" });
    }

    const totalsOf = computeQuotationTotals(items, values.shippingCharges ?? 0);

    let quotationNumber;
    let quotation;
    for (let attempt = 0; attempt < 3 && !quotation; attempt += 1) {
      quotationNumber = await nextQuotationNumber(new Date(), activeCompany);
      try {
        quotation = await Quotation.create({
          quotationNumber,
          companyId,
          client: clientId,
          clientSnapshot: buildClientSnapshot(clientDoc),
          issueDate,
          validUntil,
          lineItems: totalsOf.items,
          subTotal: totalsOf.subTotal,
          discountTotal: totalsOf.discountTotal,
          taxTotal: totalsOf.taxTotal,
          shippingCharges: totalsOf.shippingCharges,
          grandTotal: totalsOf.grandTotal,
          currency: values.currency ?? "INR",
          notes: values.notes ?? "",
          termsAndConditions: values.termsAndConditions ?? "",
          deliveryTimeline: values.deliveryTimeline ?? "",
          paymentTerms: values.paymentTerms ?? "",
          warrantyTerms: values.warrantyTerms ?? "",
          exclusions: values.exclusions ?? "",
          customFields: documentCustomFields,
          templateId: templateInfo.templateId,
          templateSnapshot: templateInfo.templateSnapshot,
          createdBy:
            req.admin?.id && mongoose.isValidObjectId(req.admin.id)
              ? req.admin.id
              : undefined,
        });
      } catch (err) {
        if (err?.code !== 11000) throw err;
      }
    }

    if (!quotation) {
      return res.status(503).json({ message: "Could not allocate a quotation number, please retry" });
    }

    audit("quotation_created", {
      actor: req.admin?.email,
      quotationNumber: quotation.quotationNumber,
      quotationId: String(quotation._id),
    });

    await quotation.populate("client");
    res.status(201).json(quotation);
  } catch (err) {
    console.error("Create quotation error:", err.message);
    const status = err.name === "ValidationError" ? 400 : 500;
    res.status(status).json({
      message: status === 400 ? err.message : "Failed to create quotation",
      ...(status === 500 && process.env.NODE_ENV !== "production" ? { error: err.message } : {}),
    });
  }
};

export const updateQuotation = async (req, res) => {
  try {
    const companyId = tenantId(req);
    if (!companyId) {
      return res.status(409).json({ message: "No active company is configured" });
    }
    if (isBadId(req.params.id)) {
      return res.status(404).json({ message: "Quotation not found" });
    }

    const quotation = await Quotation.findOne({ _id: req.params.id, companyId });
    if (!quotation) return res.status(404).json({ message: "Quotation not found" });

    if (!EDITABLE_STATUSES.has(quotation.status)) {
      return res.status(409).json({
        message: `Only draft quotations can be edited (current status: ${quotation.status})`,
      });
    }

    const { error, values } = await parseWritableBody(req.body, req, { forUpdate: true });
    if (error) return res.status(error.status).json({ message: error.message });

    delete values._validatedItems;

    if (values.client !== undefined) {
      const clientDoc = await Client.findOne({ _id: values.client, companyId });
      if (!clientDoc) return res.status(400).json({ message: "Client not found" });
      quotation.client = values.client;
      quotation.clientSnapshot = buildClientSnapshot(clientDoc);
    }

    if (values.issueDate !== undefined) quotation.issueDate = values.issueDate;
    if (values.validUntil !== undefined) quotation.validUntil = values.validUntil;

    const effectiveIssueDate = quotation.issueDate;
    const effectiveValidUntil = quotation.validUntil;
    if (effectiveValidUntil.getTime() <= effectiveIssueDate.getTime()) {
      return res.status(400).json({ message: "Valid-until date must be after the issue date" });
    }

    if (values.validUntil !== undefined && isExpiredNow({ validUntil: effectiveValidUntil })) {
      return res.status(400).json({ message: "Valid-until date cannot be in the past" });
    }

    const activeCompany = req.company || null;
    const docFieldDefs =
      quotation.templateSnapshot?.customFields ||
      (activeCompany?.customFields || []).filter(
        (f) => f.appliesTo === "quotation" || f.appliesTo === "both"
      );
    const itemFieldDefs =
      quotation.templateSnapshot?.itemCustomFields ||
      activeCompany?.itemCustomFields ||
      [];

    const effectiveCustomFields = applyCustomDefaults(
      values.customFields ?? quotation.customFields,
      docFieldDefs
    );
    if (docFieldDefs.length > 0) {
      const { error: customError } = validateCustomValues(
        effectiveCustomFields,
        docFieldDefs,
        "Quotation custom"
      );
      if (customError) return res.status(400).json({ message: customError });
    }
    values.customFields = effectiveCustomFields;

    const sourceItems = values.lineItems ?? quotation.lineItems ?? [];
    const normalizedItems = sourceItems.map((item) => ({
      description: item.description,
      category: item.category,
      itemType: item.itemType,
      unit: item.unit,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discountType: item.discountType,
      discountValue: item.discountValue,
      taxPercent: item.taxPercent,
      customFields: applyCustomDefaults(item.customFields, itemFieldDefs),
    }));
    const { error: itemError, items } = validateQuotationItems(
      normalizedItems,
      itemFieldDefs
    );
    if (itemError) return res.status(400).json({ message: itemError });
    const totals = computeQuotationTotals(
      items,
      values.shippingCharges ?? quotation.shippingCharges ?? 0
    );

    quotation.lineItems = totals.items;
    quotation.subTotal = totals.subTotal;
    quotation.discountTotal = totals.discountTotal;
    quotation.taxTotal = totals.taxTotal;
    quotation.shippingCharges = totals.shippingCharges;
    quotation.grandTotal = totals.grandTotal;

    if (values.currency !== undefined) quotation.currency = values.currency;
    quotation.customFields = effectiveCustomFields;

    for (const key of ["notes", "termsAndConditions", "deliveryTimeline", "paymentTerms", "warrantyTerms", "exclusions"]) {
      if (values[key] !== undefined) quotation[key] = values[key];
    }

    await quotation.save();
    await quotation.populate("client");

    audit("quotation_updated", {
      actor: req.admin?.email,
      quotationNumber: quotation.quotationNumber,
      quotationId: String(quotation._id),
      fields: Object.keys(values).filter((k) => k !== "_validatedItems"),
    });

    res.json(quotation);
  } catch (err) {
    console.error("Update quotation error:", err.message);
    const status = err.name === "ValidationError" ? 400 : 500;
    res.status(status).json({
      message: status === 400 ? err.message : "Failed to update quotation",
      ...(status === 500 && process.env.NODE_ENV !== "production" ? { error: err.message } : {}),
    });
  }
};

export const deleteQuotation = async (req, res) => {
  const companyId = tenantId(req);
  if (!companyId) {
    return res.status(409).json({ message: "No active company is configured" });
  }
  if (isBadId(req.params.id)) {
    return res.status(404).json({ message: "Quotation not found" });
  }

  const quotation = await Quotation.findOne({ _id: req.params.id, companyId });
  if (!quotation) return res.status(404).json({ message: "Quotation not found" });

  if (!DELETABLE_STATUSES.has(quotation.status)) {
    return res.status(409).json({
      message: `Only draft or rejected quotations can be deleted (current status: ${quotation.status})`,
    });
  }

  await Quotation.findOneAndDelete({ _id: quotation._id, companyId });

  audit("quotation_deleted", {
    actor: req.admin?.email,
    quotationNumber: quotation.quotationNumber,
    quotationId: String(quotation._id),
  });

  res.json({ message: "Quotation deleted" });
};

// Streams the quotation PDF inline (preview + download).
export const downloadQuotationPDF = async (req, res) => {
  try {
    const companyId = tenantId(req);
    if (!companyId) {
      return res.status(409).json({ message: "No active company is configured" });
    }
    if (isBadId(req.params.id)) {
      return res.status(404).json({ message: "Quotation not found" });
    }

    const quotation = await Quotation.findOne({
      _id: req.params.id,
      companyId,
    }).populate("client");
    if (!quotation) return res.status(404).json({ message: "Quotation not found" });

    const company = await resolveQuotationCompany(quotation, req);
    let pdfBuffer = await generateQuotationPDF(quotation, quotation.client || {}, company, quotation.templateSnapshot);

    if (!Buffer.isBuffer(pdfBuffer)) {
      pdfBuffer = Buffer.from(pdfBuffer);
    }

    const filename = `Quotation-${quotation.quotationNumber.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
    });
    res.end(pdfBuffer);
  } catch (error) {
    console.error("Quotation PDF error:", error.message);
    if (!res.headersSent) {
      res.status(500).json({
        message: "Failed to generate quotation PDF",
        ...(process.env.NODE_ENV !== "production" ? { error: error.message } : {}),
      });
    }
  }
};

// Email delivery: attaches the generated PDF and records the attempt.
export const emailQuotation = async (req, res) => {
  const companyId = tenantId(req);
  if (!companyId) {
    return res.status(409).json({ message: "No active company is configured" });
  }
  if (isBadId(req.params.id)) {
    return res.status(404).json({ message: "Quotation not found" });
  }

  const quotation = await Quotation.findOne({
    _id: req.params.id,
    companyId,
  }).populate("client");
  if (!quotation) return res.status(404).json({ message: "Quotation not found" });

  if (!DELIVERABLE_STATUSES.has(quotation.status)) {
    return res.status(409).json({
      message: `Quotations can be emailed only while draft or sent (current status: ${quotation.status})`,
    });
  }

  if (deliveryIsExpired(quotation)) {
    return res.status(409).json({
      message: "This quotation has expired. Update its validity date before sending it.",
    });
  }

  const rawTo = (req.body || {}).to ?? quotation.client?.email ?? quotation.clientSnapshot?.email;
  const to = typeof rawTo === "string" ? rawTo.trim() : "";

  if (!to) {
    return res.status(400).json({ message: "No email address on file for this client" });
  }

  if (!isValidEmail(to)) {
    return res.status(400).json({ message: "Enter a valid recipient email address" });
  }

  const company = await resolveQuotationCompany(quotation, req);
  const pdfBuffer = await generateQuotationPDF(quotation, quotation.client || {}, company, quotation.templateSnapshot);

  try {
    await sendQuotationEmail({
      to,
      quotationNumber: quotation.quotationNumber,
      clientName: quotation.clientSnapshot?.name || quotation.client?.name || "Customer",
      pdfBuffer,
      companyName: company?.name,
    });

    quotation.sentLog.push({ channel: "email", to, success: true });
    const previousStatus = quotation.status;
    if (quotation.status === "draft") quotation.status = "sent";
    await quotation.save();

    if (previousStatus !== quotation.status) {
      audit("quotation_status_changed", {
        actor: req.admin?.email,
        quotationNumber: quotation.quotationNumber,
        from: previousStatus,
        to: quotation.status,
      });
    }

    audit("quotation_delivery", {
      actor: req.admin?.email,
      quotationNumber: quotation.quotationNumber,
      channel: "email",
      result: "success",
    });

    res.json({ message: "Quotation emailed", to });
  } catch (err) {
    quotation.sentLog.push({
      channel: "email",
      to,
      success: false,
      error: sanitizeDeliveryError(err),
    });
    await quotation.save();

    audit("quotation_delivery", {
      actor: req.admin?.email,
      quotationNumber: quotation.quotationNumber,
      channel: "email",
      result: "failed",
    });

    res.status(502).json({
      message: "Failed to send email",
      ...(process.env.NODE_ENV !== "production" ? { error: err.message } : {}),
    });
  }
};

function normalizeWhatsAppNumber(requestedTo, fallback) {
  if (requestedTo !== undefined && typeof requestedTo !== "string") return null;

  let to = String(requestedTo || fallback || "").replace(/\D/g, "");

  if (to.length === 10) to = `91${to}`;
  else if (to.length === 11 && to.startsWith("0")) to = `91${to.slice(1)}`;

  if (to.length < 11 || to.length > 15) return null;
  return to;
}

// WhatsApp delivery via the Meta Cloud API (wa.me fallback on failure).
export const whatsappQuotation = async (req, res) => {
  const companyId = tenantId(req);
  if (!companyId) {
    return res.status(409).json({ message: "No active company is configured" });
  }
  if (isBadId(req.params.id)) {
    return res.status(404).json({ message: "Quotation not found" });
  }

  const quotation = await Quotation.findOne({
    _id: req.params.id,
    companyId,
  }).populate("client");
  if (!quotation) return res.status(404).json({ message: "Quotation not found" });

  if (!DELIVERABLE_STATUSES.has(quotation.status)) {
    return res.status(409).json({
      message: `Quotations can be sent only while draft or sent (current status: ${quotation.status})`,
    });
  }

  if (deliveryIsExpired(quotation)) {
    return res.status(409).json({
      message: "This quotation has expired. Update its validity date before sending it.",
    });
  }

  const to = normalizeWhatsAppNumber(
    (req.body || {}).to,
    quotation.client?.whatsapp || quotation.clientSnapshot?.whatsapp
  );

  if (!to) {
    return res.status(400).json({
      message: "No WhatsApp number on file for this client",
    });
  }

  const company = await resolveQuotationCompany(quotation, req);
  const pdfBuffer = await generateQuotationPDF(quotation, quotation.client || {}, company, quotation.templateSnapshot);

  try {
    await sendQuotationWhatsApp({
      to,
      quotationNumber: quotation.quotationNumber,
      pdfBuffer,
    });

    quotation.sentLog.push({ channel: "whatsapp", to, success: true });
    const previousStatus = quotation.status;
    if (quotation.status === "draft") quotation.status = "sent";
    await quotation.save();

    if (previousStatus !== quotation.status) {
      audit("quotation_status_changed", {
        actor: req.admin?.email,
        quotationNumber: quotation.quotationNumber,
        from: previousStatus,
        to: quotation.status,
      });
    }

    audit("quotation_delivery", {
      actor: req.admin?.email,
      quotationNumber: quotation.quotationNumber,
      channel: "whatsapp",
      result: "success",
    });

    res.json({ message: "Quotation sent on WhatsApp", to });
  } catch (err) {
    console.error(
      "WhatsApp send error:",
      err.response?.data?.error?.message || err.message
    );
    quotation.sentLog.push({
      channel: "whatsapp",
      to,
      success: false,
      error: sanitizeDeliveryError(err),
    });
    await quotation.save();

    audit("quotation_delivery", {
      actor: req.admin?.email,
      quotationNumber: quotation.quotationNumber,
      channel: "whatsapp",
      result: "failed",
    });

    res.status(502).json({
      message: "WhatsApp Cloud API send failed",
      ...(process.env.NODE_ENV !== "production"
        ? { error: err.response?.data?.error?.message || err.message }
        : {}),
      shareLink: buildQuotationShareLink({
        to,
        quotationNumber: quotation.quotationNumber,
        companyName: company?.name,
      }),
    });
  }
};

const sanitizeDecisionNote = (value) => {
  if (value === undefined) return "";
  if (typeof value !== "string") return null;
  return value.trim().slice(0, 500);
};

export const acceptQuotation = async (req, res) => {
  const companyId = tenantId(req);
  if (!companyId) {
    return res.status(409).json({ message: "No active company is configured" });
  }
  if (isBadId(req.params.id)) {
    return res.status(404).json({ message: "Quotation not found" });
  }

  const note = sanitizeDecisionNote((req.body || {}).note);
  if (note === null) return res.status(400).json({ message: "Note must be text" });

  const quotation = await Quotation.findOne({ _id: req.params.id, companyId });
  if (!quotation) return res.status(404).json({ message: "Quotation not found" });

  if (quotation.status === "accepted") {
    return res.json({ message: "Quotation is already accepted", quotation });
  }

  if (!ACCEPTABLE_STATUSES.has(quotation.status)) {
    return res.status(409).json({
      message: `Only draft or sent quotations can be accepted (current status: ${quotation.status})`,
    });
  }

  if (isExpiredNow(quotation)) {
    return res.status(409).json({
      message: "This quotation has expired (valid-until date passed) and can no longer be accepted",
    });
  }

  const result = await Quotation.updateOne(
    {
      _id: quotation._id,
      companyId,
      status: { $in: ["draft", "sent"] },
      validUntil: { $gte: startOfToday() },
    },
    { $set: { status: "accepted", acceptedAt: new Date(), decisionNote: note } }
  );

  if (result.modifiedCount !== 1) {
    const latest = await Quotation.findOne({ _id: req.params.id, companyId });
    if (latest?.status === "accepted") {
      return res.json({ message: "Quotation is already accepted", quotation: latest });
    }
    return res.status(409).json({ message: "Quotation can no longer be accepted" });
  }

  audit("quotation_accepted", {
    actor: req.admin?.email,
    quotationNumber: quotation.quotationNumber,
    quotationId: String(quotation._id),
  });

  const updated = await Quotation.findOne({
    _id: req.params.id,
    companyId,
  }).populate("client");
  res.json({ message: "Quotation accepted", quotation: updated });
};

export const rejectQuotation = async (req, res) => {
  const companyId = tenantId(req);
  if (!companyId) {
    return res.status(409).json({ message: "No active company is configured" });
  }
  if (isBadId(req.params.id)) {
    return res.status(404).json({ message: "Quotation not found" });
  }

  const note = sanitizeDecisionNote((req.body || {}).note ?? (req.body || {}).reason);
  if (note === null) return res.status(400).json({ message: "Note must be text" });

  const quotation = await Quotation.findOne({ _id: req.params.id, companyId });
  if (!quotation) return res.status(404).json({ message: "Quotation not found" });

  if (quotation.status === "rejected") {
    return res.status(409).json({ message: "Quotation is already rejected" });
  }

  if (!REJECTABLE_STATUSES.has(quotation.status)) {
    return res.status(409).json({
      message: `Only draft or sent quotations can be rejected (current status: ${quotation.status})`,
    });
  }

  const result = await Quotation.updateOne(
    { _id: quotation._id, companyId, status: { $in: ["draft", "sent"] } },
    { $set: { status: "rejected", rejectedAt: new Date(), decisionNote: note } }
  );

  if (result.modifiedCount !== 1) {
    return res.status(409).json({ message: "Quotation can no longer be rejected" });
  }

  audit("quotation_rejected", {
    actor: req.admin?.email,
    quotationNumber: quotation.quotationNumber,
    quotationId: String(quotation._id),
  });

  const updated = await Quotation.findOne({
    _id: req.params.id,
    companyId,
  }).populate("client");
  res.json({ message: "Quotation rejected", quotation: updated });
};

// ---------------------------------------------------------------------------
// Quotation -> Invoice conversion
// ---------------------------------------------------------------------------
export const convertQuotationToInvoice = async (req, res) => {
  const companyId = tenantId(req);
  if (!companyId) {
    return res.status(409).json({ message: "No active company is configured" });
  }
  if (isBadId(req.params.id)) {
    return res.status(404).json({ message: "Quotation not found" });
  }

  let quotation = await Quotation.findOne({ _id: req.params.id, companyId });
  if (!quotation) return res.status(404).json({ message: "Quotation not found" });

  const respondAlreadyConverted = async (current) => {
    let invoice = current.convertedInvoice
      ? await Invoice.findOne({ _id: current.convertedInvoice, companyId })
      : null;

    if (!invoice) {
      invoice = await Invoice.findOne({ sourceQuotation: current._id, companyId });
    }

    if (!invoice) {
      return res.status(409).json({
        message: "This quotation is marked converted but the linked invoice could not be found",
      });
    }

    if (
      current.status !== "converted" ||
      String(current.convertedInvoice || "") !== String(invoice._id)
    ) {
      await Quotation.updateOne(
        { _id: current._id, companyId, status: { $in: ["accepted", "converted"] } },
        {
          $set: {
            status: "converted",
            convertedInvoice: invoice._id,
            conversionToken: null,
          },
        }
      ).catch(() => {});
      current = await Quotation.findOne({ _id: current._id, companyId }).populate("client");
    }

    const fresh = await Quotation.findOne({ _id: current._id, companyId }).populate("client");
    return res.json({
      message: "This quotation has already been converted",
      invoice,
      quotation: fresh || current,
    });
  };

  if (quotation.status === "converted") {
    return respondAlreadyConverted(quotation);
  }

  const orphanedInvoice = await Invoice.findOne({
    sourceQuotation: quotation._id,
    companyId,
  });
  if (orphanedInvoice) {
    return respondAlreadyConverted(quotation);
  }

  if (quotation.status !== "accepted") {
    return res.status(409).json({
      message: `Only accepted quotations can be converted (current status: ${quotation.status})`,
    });
  }

  if (!(await Client.exists({ _id: quotation.client, companyId }))) {
    return res.status(409).json({
      message: "The client for this quotation no longer exists. Restore it or create the invoice manually.",
    });
  }

  const taxRates = (quotation.lineItems || []).map((item) => Number(item.taxPercent || 0));
  const uniqueRates = new Set(taxRates.map((rate) => rate.toFixed(4)));
  if (uniqueRates.size > 1) {
    return res.status(409).json({
      message:
        "This quotation mixes different tax rates across line items and cannot be converted automatically. Please create the invoice manually.",
    });
  }
  const uniformTax = taxRates[0] || 0;

  // Map items preserving line-item customFields
  const invoiceItems = quotation.lineItems.map((item) => {
    const qty = Number(item.quantity);
    const base = safeMoney(qty * Number(item.unitPrice));
    const taxable = safeMoney(base - Number(item.discountAmount || 0));
    return {
      description: item.description,
      category: "other",
      quantity: qty,
      rate: taxable / qty,
      customFields: item.customFields || {},
    };
  });

  const shipping = Number(quotation.shippingCharges || 0);
  if (shipping > 0) {
    invoiceItems.push({
      description: "Shipping / Handling charges",
      category: "other",
      quantity: 1,
      rate: uniformTax > 0 ? shipping / (1 + uniformTax / 100) : shipping,
      customFields: {},
    });
  }

  const notePrefix = `Converted from quotation ${quotation.quotationNumber}.`;
  const composedNotes = quotation.notes?.trim()
    ? `${notePrefix} ${quotation.notes.trim()}`
    : notePrefix;

  const company = await resolveQuotationCompany(quotation, req);

  const buildInvoicePayload = async () => {
    const invoiceDate = new Date();
    const dueDate = new Date(invoiceDate);
    dueDate.setDate(dueDate.getDate() + 15);

    const invoiceNumber = await nextInvoiceNumber(invoiceDate, company);
    const { items, subTotal, taxAmount, grandTotal } = computeTotals(invoiceItems, uniformTax);

    let invoiceTemplate = { templateId: null, templateSnapshot: null };
    if (company) {
      invoiceTemplate = await snapshotForDocument(company, "invoice", null);
    }

    return {
      invoiceNumber,
      companyId,
      client: quotation.client,
      date: invoiceDate,
      dueDate,
      lineItems: items,
      subTotal,
      taxPercent: uniformTax,
      taxAmount,
      grandTotal,
      notes: composedNotes,
      status: "draft",
      customFields: quotation.customFields || {},
      templateId: invoiceTemplate.templateId,
      templateSnapshot: invoiceTemplate.templateSnapshot,
      sourceQuotation: quotation._id,
    };
  };

  let createdInvoice = null;
  let lostRace = false;
  let duplicateConversion = false;

  let txnSupported = false;
  try {
    const probe = await mongoose.connection.startSession();
    try {
      await probe.startTransaction();
      try {
        await mongoose.connection.db.collection("__txn_probe__").insertOne(
          { startedAt: new Date() },
          { session: probe }
        );
        await probe.abortTransaction();
        txnSupported = true;
      } catch {
        txnSupported = false;
      }
    } finally {
      await probe.endSession().catch(() => {});
    }
  } catch (err) {
    console.error("Transaction probe failed (falling back to claim-lease):", err.message);
    txnSupported = false;
  }
  await mongoose.connection.db.collection("__txn_probe__").drop().catch(() => {});

  if (txnSupported) {
    let session = null;
    try {
      session = await mongoose.connection.startSession();
      await session.withTransaction(async () => {
        const payload = await buildInvoicePayload();
        const [invoice] = await Invoice.create([payload], { session });

        const claim = await Quotation.updateOne(
          { _id: quotation._id, companyId, status: "accepted" },
          {
            $set: {
              status: "converted",
              convertedInvoice: invoice._id,
              conversionToken: null,
            },
          },
          { session }
        );

        if (claim.modifiedCount !== 1) {
          throw new Error("QUOTATION_CONVERSION_LOST_RACE");
        }

        createdInvoice = invoice;
      });
    } catch (err) {
      duplicateConversion = err?.code === 11000;
      if (err?.message !== "QUOTATION_CONVERSION_LOST_RACE" && !duplicateConversion) {
        console.error("Conversion transaction error:", err.message);
      }
      lostRace = err?.message === "QUOTATION_CONVERSION_LOST_RACE";
      createdInvoice = null;
    } finally {
      await session.endSession().catch(() => {});
    }
  }

  if (!txnSupported && !createdInvoice && !lostRace && !duplicateConversion) {
    const CLAIM_MAX_AGE_MS = 120000;

    const claimToken = new mongoose.Types.ObjectId();
    const staleBoundary = new mongoose.Types.ObjectId(
      Math.floor((Date.now() - CLAIM_MAX_AGE_MS) / 1000)
    );

    const claim = await Quotation.updateOne(
      {
        _id: quotation._id,
        companyId,
        status: "accepted",
        convertedInvoice: { $exists: false },
        $or: [
          { conversionToken: null },
          { conversionToken: { $lt: staleBoundary } },
        ],
      },
      { $set: { conversionToken: claimToken } }
    );

    if (claim.modifiedCount === 1) {
      try {
        const payload = await buildInvoicePayload();
        const [invoice] = await Invoice.create([payload], {});

        const finalize = await Quotation.updateOne(
          { _id: quotation._id, companyId, conversionToken: claimToken, status: "accepted" },
          {
            $set: {
              status: "converted",
              convertedInvoice: invoice._id,
              conversionToken: null,
            },
          }
        );

        if (finalize.modifiedCount === 1) {
          createdInvoice = invoice;
        } else {
          console.error(
            `Conversion finalize failed for quotation ${quotation.quotationNumber}; created invoice ${payload.invoiceNumber} was not linked`
          );
        }
      } catch (err) {
        duplicateConversion = err?.code === 11000;
        if (!duplicateConversion) {
          console.error("Conversion fallback error:", err.message);
        }
        await Quotation.updateOne(
          { _id: quotation._id, companyId, conversionToken: claimToken, status: "accepted" },
          { $set: { conversionToken: null } }
        ).catch(() => {});
      }
    } else {
      lostRace = true;
    }
  }

  quotation = await Quotation.findOne({ _id: quotation._id, companyId }).populate("client");

  if (quotation.status === "converted" && quotation.convertedInvoice) {
    if (createdInvoice) {
      return res.status(201).json({
        message: "Quotation converted into a draft invoice",
        invoice: createdInvoice,
        quotation,
      });
    }
    return respondAlreadyConverted(quotation);
  }

  const committedInvoice = await Invoice.findOne({
    sourceQuotation: quotation._id,
    companyId,
  });
  if (committedInvoice) {
    return respondAlreadyConverted(quotation);
  }

  if (!createdInvoice) {
    return res.status(409).json({
      message: lostRace
        ? "This quotation is being converted by another request"
        : "Conversion failed, please retry",
    });
  }

  const finalize = await Quotation.updateOne(
    { _id: quotation._id, companyId, status: "accepted" },
    {
      $set: {
        status: "converted",
        convertedInvoice: createdInvoice._id,
        conversionToken: null,
      },
    }
  ).catch(() => ({ modifiedCount: 0 }));

  if (finalize.modifiedCount !== 1) {
    return respondAlreadyConverted(quotation);
  }

  audit("quotation_converted", {
    actor: req.admin?.email,
    quotationNumber: quotation.quotationNumber,
    invoiceNumber: createdInvoice.invoiceNumber,
    invoiceId: String(createdInvoice._id),
  });

  quotation.status = "converted";
  quotation.convertedInvoice = createdInvoice._id;

  res.status(201).json({
    message: "Quotation converted into a draft invoice",
    invoice: createdInvoice,
    quotation,
  });
};
