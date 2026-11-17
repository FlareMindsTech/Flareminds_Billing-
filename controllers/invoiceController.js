import mongoose from "mongoose";
import Invoice from "../models/Invoice.js";
import Client from "../models/Client.js";
import Company from "../models/Company.js";
import Counter from "../models/Counter.js";
import { generateInvoicePDF } from "../services/pdfService.js";
import { sendInvoiceEmail } from "../services/emailService.js";
import { sendInvoiceWhatsApp, buildWhatsAppShareLink } from "../services/whatsappService.js";
import { audit } from "../utils/auditLog.js";
import { isValidEmail } from "../utils/validation.js";
import {
  applyInvoicePaymentState,
  invoicePaymentState,
  roundMoney,
  startOfToday,
  withEffectivePaymentFields,
} from "../utils/invoicePayments.js";
import { snapshotForDocument } from "./templateController.js";

const INVOICE_UPDATE_FIELDS = [
  "client",
  "date",
  "dueDate",
  "lineItems",
  "taxPercent",
  "notes",
  "status",
  "customFields",
];
const LINE_ITEM_CATEGORIES = new Set(["digital-marketing", "development", "other"]);
const INVOICE_STATUSES = new Set([
  "draft",
  "sent",
  "partially_paid",
  "paid",
  "overdue",
  "cancelled",
]);

const isBadId = (id) => !mongoose.isValidObjectId(id);

const tenantId = (req) => req.companyId || req.company?._id || req.admin?.companyId || null;

export function applyCustomDefaults(customValues = {}, fieldDefs = []) {
  const result = {
    ...(customValues && typeof customValues === "object" && !Array.isArray(customValues)
      ? customValues
      : {}),
  };
  for (const def of fieldDefs) {
    if (!def?.key) continue;
    const value = result[def.key];
    if (value === undefined || value === null || value === "") {
      if (def.defaultValue !== undefined && def.defaultValue !== null) {
        result[def.key] = def.defaultValue;
      }
    }
  }
  return result;
}

const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

// Returns an error message, or null when the line items are valid.
function validateLineItems(lineItems, itemFieldDefs = []) {
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    return "Invoice must have at least one line item";
  }

  for (const [index, item] of lineItems.entries()) {
    if (!item || !String(item.description || "").trim()) {
      return "Each line item needs a description";
    }

    const quantity = Number(item.quantity ?? 1);
    const rate = Number(item.rate);

    if (!Number.isFinite(quantity) || quantity < 1) {
      return "Line item quantity must be at least 1";
    }

    if (!Number.isFinite(rate) || rate < 0) {
      return "Line item rate must be a number greater than or equal to 0";
    }

    if (item.category !== undefined && !LINE_ITEM_CATEGORIES.has(item.category)) {
      return "Invalid line item category";
    }

    if (itemFieldDefs.length > 0) {
      const values =
        item.customFields &&
        typeof item.customFields === "object" &&
        !Array.isArray(item.customFields)
          ? item.customFields
          : {};
      const { error } = validateCustomValues(
        values,
        itemFieldDefs,
        `Line item ${index + 1} custom`
      );
      if (error) return error;
    }
  }

  return null;
}

function parseTaxPercent(value) {
  const tax = Number(value ?? 0);
  return Number.isFinite(tax) && tax >= 0 && tax <= 100 ? tax : null;
}

export function validateCustomValues(customValues = {}, fieldDefs = [], prefix = "Custom") {
  if (!customValues || typeof customValues !== "object" || Array.isArray(customValues)) {
    return { error: `${prefix} values must be an object` };
  }

  const defMap = new Map();
  for (const def of fieldDefs) {
    if (def.key) defMap.set(def.key, def);
  }

  for (const def of fieldDefs) {
    if (def.required) {
      const val = customValues[def.key];
      if (val === undefined || val === null || val === "") {
        return { error: `${def.label || def.key} is required` };
      }
    }
  }

  for (const [key, val] of Object.entries(customValues)) {
    const def = defMap.get(key);
    if (!def) continue;

    if (def.type === "number" && val !== "" && val !== null && val !== undefined) {
      if (!Number.isFinite(Number(val))) {
        return { error: `${def.label || key} must be a number` };
      }
    }
    if (def.type === "select" && val && Array.isArray(def.options) && def.options.length > 0) {
      if (!def.options.includes(String(val))) {
        return { error: `Invalid option for ${def.label || key}` };
      }
    }
  }

  return { error: null };
}

// Generates the next invoice number for the current year, e.g. FM-2026-0003 or ACME-2026-0001
// Scoped per company with atomic increment to prevent race conditions.
export async function nextInvoiceNumber(now = new Date(), company = null) {
  const year = (now instanceof Date ? now : new Date()).getFullYear();
  const prefix = (company?.invoicePrefix || "FM").trim();

  const isDefaultCompany = !company || !company.code || company.code === "DEFAULT";
  const counterKey = isDefaultCompany
    ? `invoiceNumber_${year}`
    : `invoiceNumber_${company.code}_${year}`;

  let isUnique = false;
  let finalInvoiceNumber = "";

  while (!isUnique) {
    // 1. Atomic increment counter
    const counter = await Counter.findByIdAndUpdate(
      counterKey,
      { $inc: { sequence: 1 } },
      { new: true, upsert: true }
    );

    const candidateNumber = `${prefix}-${year}-${String(counter.sequence).padStart(4, "0")}`;

    // 2. Double-check that this invoice number doesn't already exist in DB
    const existing = await Invoice.findOne({ invoiceNumber: candidateNumber });
    if (!existing) {
      finalInvoiceNumber = candidateNumber;
      isUnique = true;
    }
  }

  return finalInvoiceNumber;
}

// Recomputes amount per line item and the invoice totals server-side,
// so the frontend can't send a tampered grand total.
export function computeTotals(lineItems, taxPercent = 0) {
  const items = lineItems.map((item) => ({
    ...item,
    amount: Number(item.quantity || 1) * Number(item.rate),
    customFields: item.customFields || {},
  }));
  const subTotal = items.reduce((sum, item) => sum + item.amount, 0);
  const taxAmount = (subTotal * Number(taxPercent || 0)) / 100;
  const grandTotal = subTotal + taxAmount;
  return { items, subTotal, taxAmount, grandTotal };
}

export const listInvoices = async (req, res) => {
  const { status, client } = req.query;
  const companyId = tenantId(req);
  if (!companyId) {
    return res.status(409).json({ message: "No active company is configured" });
  }
  const conditions = [{ companyId }];

  if (status !== undefined) {
    if (typeof status !== "string" || !INVOICE_STATUSES.has(status)) {
      return res.status(400).json({ message: "Invalid status filter" });
    }

    if (status === "overdue") {
      // Unpaid invoices become overdue when their due date passes even if the
      // stored status is still "sent"; include those in the filter.
      conditions.push({
        $or: [
          { status: "overdue" },
          {
            status: { $in: ["sent", "partially_paid"] },
            dueDate: { $lt: startOfToday() },
          },
        ],
      });
    } else if (status === "partially_paid") {
      // Older rows may still carry "overdue" while holding a partial payment.
      conditions.push({
        $or: [
          { status: "partially_paid" },
          { status: "overdue", amountPaid: { $gt: 0 } },
        ],
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

  const filter = conditions.length === 1 ? conditions[0] : { $and: conditions };
  const invoices = await Invoice.find(filter)
    .populate("client")
    .sort({ createdAt: -1 });
  res.json(invoices.map((invoice) => withEffectivePaymentFields(invoice)));
};

export const getInvoice = async (req, res) => {
  const companyId = tenantId(req);
  if (!companyId) {
    return res.status(409).json({ message: "No active company is configured" });
  }
  if (isBadId(req.params.id)) {
    return res.status(404).json({ message: "Invoice not found" });
  }

  const invoice = await Invoice.findOne({
    _id: req.params.id,
    companyId,
  }).populate("client");
  if (!invoice) return res.status(404).json({ message: "Invoice not found" });
  res.json(withEffectivePaymentFields(invoice));
};

export const createInvoice = async (req, res) => {
  try {
    const { client, lineItems, taxPercent, date, dueDate, notes, customFields } = req.body || {};
    const companyId = tenantId(req);

    if (!companyId) {
      return res.status(409).json({ message: "No active company is configured" });
    }
    if (!client || isBadId(client)) {
      return res.status(400).json({ message: "A valid client is required" });
    }
    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      return res.status(400).json({ message: "At least one line item is required" });
    }

    const clientDoc = await Client.findOne({ _id: client, companyId });
    if (!clientDoc) return res.status(400).json({ message: "Client not found" });

    const activeCompany = req.company || null;

    let templateInfo = { templateId: null, templateSnapshot: null };
    if (activeCompany) {
      try {
        templateInfo = await snapshotForDocument(
          activeCompany,
          "invoice",
          req.body?.templateId || null
        );
      } catch (err) {
        return res.status(err.status || 400).json({ message: err.message });
      }
    }

    const docFieldDefs =
      templateInfo.templateSnapshot?.customFields ||
      (activeCompany?.customFields || []).filter(
        (f) => f.appliesTo === "invoice" || f.appliesTo === "both"
      );
    const itemFieldDefs =
      templateInfo.templateSnapshot?.itemCustomFields ||
      activeCompany?.itemCustomFields ||
      [];

    const documentCustomFields = applyCustomDefaults(customFields, docFieldDefs);
    if (docFieldDefs.length > 0) {
      const { error: customErr } = validateCustomValues(
        documentCustomFields,
        docFieldDefs,
        "Invoice custom"
      );
      if (customErr) return res.status(400).json({ message: customErr });
    }

    const normalizedItems = lineItems.map((item) => ({
      ...item,
      customFields: applyCustomDefaults(item.customFields, itemFieldDefs),
    }));
    const lineItemError = validateLineItems(normalizedItems, itemFieldDefs);
    if (lineItemError) return res.status(400).json({ message: lineItemError });

    const tax = parseTaxPercent(taxPercent);
    if (tax === null) {
      return res.status(400).json({ message: "Tax percent must be a number between 0 and 100" });
    }

    const invoiceDate = date ? parseDate(date) : new Date();
    if (!invoiceDate) {
      return res.status(400).json({ message: "Invoice date is not a valid date" });
    }

    const invoiceDueDate = dueDate ? parseDate(dueDate) : null;
    if (dueDate && !invoiceDueDate) {
      return res.status(400).json({ message: "Due date is not a valid date" });
    }

    if (invoiceDueDate && invoiceDueDate <= invoiceDate) {
      return res.status(400).json({ message: "Due date must be after invoice date" });
    }

    const { items, subTotal, taxAmount, grandTotal } = computeTotals(normalizedItems, tax);
    const invoiceNumber = await nextInvoiceNumber(invoiceDate, activeCompany);

    const invoicePayload = {
      invoiceNumber,
      companyId,
      client,
      date: invoiceDate,
      dueDate: invoiceDueDate,
      lineItems: items,
      subTotal,
      taxPercent: tax,
      taxAmount,
      grandTotal,
      amountPaid: 0,
      balanceDue: roundMoney(grandTotal),
      notes: notes || "",
      customFields: documentCustomFields,
      templateId: templateInfo.templateId,
      templateSnapshot: templateInfo.templateSnapshot,
    };

    const invoice = await Invoice.create(invoicePayload);

    audit("invoice_created", {
      actor: req.admin?.email,
      invoiceNumber: invoice.invoiceNumber,
      invoiceId: String(invoice._id),
    });

    res.status(201).json(invoice);
  } catch (err) {
    console.error("Create invoice error:", err.message);
    const status = err.name === "ValidationError" ? 400 : 500;
    res.status(status).json({
      message: status === 400 ? err.message : "Failed to create invoice",
    });
  }
};

export const updateInvoice = async (req, res) => {
  try {
    const companyId = tenantId(req);
    if (!companyId) {
      return res.status(409).json({ message: "No active company is configured" });
    }
    if (isBadId(req.params.id)) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    const invoice = await Invoice.findOne({ _id: req.params.id, companyId });
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    const body = req.body || {};
    const updates = {};
    for (const key of INVOICE_UPDATE_FIELDS) {
      if (body[key] !== undefined) updates[key] = body[key];
    }

    if (updates.client !== undefined) {
      if (
        isBadId(updates.client) ||
        !(await Client.exists({ _id: updates.client, companyId }))
      ) {
        return res.status(400).json({ message: "Client not found" });
      }
    }

    if (updates.date !== undefined) {
      const nextDate = parseDate(updates.date);
      if (!nextDate) return res.status(400).json({ message: "Invoice date is not a valid date" });
      updates.date = nextDate;
    }

    if (updates.dueDate !== undefined) {
      const nextDueDate = updates.dueDate ? parseDate(updates.dueDate) : null;
      if (updates.dueDate && !nextDueDate) {
        return res.status(400).json({ message: "Due date is not a valid date" });
      }
      updates.dueDate = nextDueDate;
    }

    const activeCompany = req.company || null;
    const docFieldDefs =
      invoice.templateSnapshot?.customFields ||
      (activeCompany?.customFields || []).filter(
        (f) => f.appliesTo === "invoice" || f.appliesTo === "both"
      );
    const itemFieldDefs =
      invoice.templateSnapshot?.itemCustomFields ||
      activeCompany?.itemCustomFields ||
      [];

    const effectiveCustomFields = applyCustomDefaults(
      updates.customFields ?? invoice.customFields,
      docFieldDefs
    );
    if (docFieldDefs.length > 0) {
      const { error: customErr } = validateCustomValues(
        effectiveCustomFields,
        docFieldDefs,
        "Invoice custom"
      );
      if (customErr) return res.status(400).json({ message: customErr });
    }
    updates.customFields = effectiveCustomFields;

    if (updates.lineItems !== undefined && !Array.isArray(updates.lineItems)) {
      return res.status(400).json({ message: "Line items must be an array" });
    }

    if (updates.taxPercent !== undefined) {
      const tax = parseTaxPercent(updates.taxPercent);
      if (tax === null) {
        return res.status(400).json({ message: "Tax percent must be a number between 0 and 100" });
      }
      updates.taxPercent = tax;
    }

    if (updates.status !== undefined && !INVOICE_STATUSES.has(updates.status)) {
      return res.status(400).json({ message: "Invalid invoice status" });
    }

    const effectiveDate = updates.date ?? invoice.date;
    const effectiveDueDate = updates.dueDate !== undefined ? updates.dueDate : invoice.dueDate;
    if (effectiveDueDate && effectiveDueDate <= effectiveDate) {
      return res.status(400).json({ message: "Due date must be after invoice date" });
    }

    const effectiveItems = (updates.lineItems ?? invoice.lineItems).map((item) => ({
      description: item.description,
      category: item.category,
      quantity: item.quantity,
      rate: item.rate,
      customFields: applyCustomDefaults(item.customFields, itemFieldDefs),
    }));
    const effectiveItemError = validateLineItems(effectiveItems, itemFieldDefs);
    if (effectiveItemError) {
      return res.status(400).json({ message: effectiveItemError });
    }
    const effectiveTax = updates.taxPercent ?? invoice.taxPercent ?? 0;
    const { items, subTotal, taxAmount, grandTotal } = computeTotals(effectiveItems, effectiveTax);

    const paymentStateBeforeUpdate = invoicePaymentState(invoice);
    const effectivePaid = paymentStateBeforeUpdate.amountPaid;

    if (effectivePaid > roundMoney(grandTotal)) {
      return res.status(400).json({
        message: "Grand total cannot be less than the amount already paid",
      });
    }

    if (
      updates.status === "paid" &&
      roundMoney(grandTotal - effectivePaid) > 0
    ) {
      return res.status(400).json({
        message: "Record a payment for the remaining balance before marking this invoice paid",
      });
    }

    if (
      ["draft", "cancelled"].includes(updates.status) &&
      effectivePaid > 0
    ) {
      return res.status(400).json({
        message: "Void all payments before reverting this invoice to draft or cancelling it",
      });
    }

    const previousStatus = invoice.status;
    const changedFields = Object.keys(updates);

    Object.assign(invoice, updates, {
      lineItems: items,
      subTotal,
      taxAmount,
      grandTotal,
      amountPaid: effectivePaid,
      balanceDue: roundMoney(Math.max(0, grandTotal - effectivePaid)),
    });

    // Re-derive the status so paid/partially_paid/overdue always agree with the
    // money recorded against this invoice.
    applyInvoicePaymentState(invoice, [{ amount: effectivePaid }]);

    await invoice.save();
    await invoice.populate("client");

    audit("invoice_updated", {
      actor: req.admin?.email,
      invoiceNumber: invoice.invoiceNumber,
      invoiceId: String(invoice._id),
      fields: changedFields,
    });

    if (previousStatus !== invoice.status) {
      audit("invoice_status_changed", {
        actor: req.admin?.email,
        invoiceNumber: invoice.invoiceNumber,
        from: previousStatus,
        to: invoice.status,
      });
    }

    res.json(withEffectivePaymentFields(invoice));
  } catch (err) {
    console.error("Update invoice error:", err.message);
    const status = err.name === "ValidationError" ? 400 : 500;
    res.status(status).json({
      message: status === 400 ? err.message : "Failed to update invoice",
    });
  }
};

export const deleteInvoice = async (req, res) => {
  const companyId = tenantId(req);
  if (!companyId) {
    return res.status(409).json({ message: "No active company is configured" });
  }
  if (isBadId(req.params.id)) {
    return res.status(404).json({ message: "Invoice not found" });
  }

  const invoice = await Invoice.findOne({ _id: req.params.id, companyId });
  if (!invoice) return res.status(404).json({ message: "Invoice not found" });
  await invoice.deleteOne();

  audit("invoice_deleted", {
    actor: req.admin?.email,
    invoiceNumber: invoice.invoiceNumber,
    invoiceId: String(invoice._id),
  });

  res.json({ message: "Invoice deleted" });
};

async function resolveInvoiceCompany(invoice, req) {
  if (invoice.companyId) {
    const comp = await Company.findById(invoice.companyId);
    if (comp) return comp;
  }
  return req.company || null;
}

// Streams the invoice as a downloadable/viewable PDF with company branding & customization.
export const downloadInvoicePDF = async (req, res) => {
  try {
    const companyId = tenantId(req);
    if (!companyId) {
      return res.status(409).json({ message: "No active company is configured" });
    }
    if (isBadId(req.params.id)) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    const invoice = await Invoice.findOne({
      _id: req.params.id,
      companyId,
    }).populate("client");
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });
    if (!invoice.client) {
      return res.status(409).json({ message: "This invoice's client no longer exists" });
    }

    const company = await resolveInvoiceCompany(invoice, req);
    let pdfBuffer = await generateInvoicePDF(invoice, invoice.client, company, invoice.templateSnapshot);

    if (!Buffer.isBuffer(pdfBuffer)) {
      pdfBuffer = Buffer.from(pdfBuffer);
    }

    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${(invoice.client?.name || "Client").trim().replace(/[^a-zA-Z0-9-_]/g, "_")}.pdf"`,
    });

    res.end(pdfBuffer);
  } catch (error) {
    console.error("PDF error:", error.message);
    if (!res.headersSent) {
      res.status(500).json({
        message: "Failed to generate PDF",
        ...(process.env.NODE_ENV !== "production" ? { error: error.message } : {}),
      });
    }
  }
};

export const emailInvoice = async (req, res) => {
  const companyId = tenantId(req);
  if (!companyId) {
    return res.status(409).json({ message: "No active company is configured" });
  }
  if (isBadId(req.params.id)) {
    return res.status(404).json({ message: "Invoice not found" });
  }

  const invoice = await Invoice.findOne({
    _id: req.params.id,
    companyId,
  }).populate("client");
  if (!invoice) return res.status(404).json({ message: "Invoice not found" });
  if (!invoice.client) {
    return res.status(409).json({ message: "This invoice's client no longer exists" });
  }

  const rawTo = (req.body || {}).to ?? invoice.client.email;
  const to = typeof rawTo === "string" ? rawTo.trim() : "";

  if (!to) {
    return res.status(400).json({ message: "No email address on file for this client" });
  }

  if (!isValidEmail(to)) {
    return res.status(400).json({ message: "Enter a valid recipient email address" });
  }

  const company = await resolveInvoiceCompany(invoice, req);
  const pdfBuffer = await generateInvoicePDF(invoice, invoice.client, company, invoice.templateSnapshot);

  try {
    await sendInvoiceEmail({
      to,
      invoiceNumber: invoice.invoiceNumber,
      clientName: invoice.client.name,
      pdfBuffer,
      companyName: company?.name,
    });
    invoice.sentLog.push({ channel: "email", to, success: true });
    if (invoice.status === "draft") invoice.status = "sent";
    const emailPaymentState = invoicePaymentState(invoice);
    invoice.amountPaid = emailPaymentState.amountPaid;
    invoice.balanceDue = emailPaymentState.balanceDue;
    await invoice.save();

    audit("invoice_delivery", {
      actor: req.admin?.email,
      invoiceNumber: invoice.invoiceNumber,
      channel: "email",
      result: "success",
    });

    res.json({ message: "Invoice emailed", to });
  } catch (err) {
    invoice.sentLog.push({ channel: "email", to, success: false, error: err.message });
    await invoice.save();

    audit("invoice_delivery", {
      actor: req.admin?.email,
      invoiceNumber: invoice.invoiceNumber,
      channel: "email",
      result: "failed",
    });

    res.status(502).json({
      message: "Failed to send email",
      ...(process.env.NODE_ENV !== "production" ? { error: err.message } : {}),
    });
  }
};

export const whatsappInvoice = async (req, res) => {
  const companyId = tenantId(req);
  if (!companyId) {
    return res.status(409).json({ message: "No active company is configured" });
  }
  if (isBadId(req.params.id)) {
    return res.status(404).json({ message: "Invoice not found" });
  }

  const invoice = await Invoice.findOne({
    _id: req.params.id,
    companyId,
  }).populate("client");
  if (!invoice) return res.status(404).json({ message: "Invoice not found" });
  if (!invoice.client) {
    return res.status(409).json({ message: "This invoice's client no longer exists" });
  }

  const requestedTo = req.body?.to;
  if (requestedTo !== undefined && typeof requestedTo !== "string") {
    return res.status(400).json({ message: "WhatsApp number must be a string" });
  }

  let to = String(requestedTo || invoice.client.whatsapp || "").replace(/\D/g, "");

  if (!to) {
    return res.status(400).json({ message: "No WhatsApp number on file for this client" });
  }

  if (to.length === 10) {
    to = `91${to}`;
  } else if (to.length === 11 && to.startsWith("0")) {
    to = `91${to.slice(1)}`;
  }

  if (to.length < 11 || to.length > 15) {
    return res.status(400).json({
      message: "WhatsApp number must be in international format (11-15 digits)",
    });
  }

  const company = await resolveInvoiceCompany(invoice, req);
  const pdfBuffer = await generateInvoicePDF(invoice, invoice.client, company, invoice.templateSnapshot);

  try {
    await sendInvoiceWhatsApp({ to, invoiceNumber: invoice.invoiceNumber, pdfBuffer });

    invoice.sentLog.push({ channel: "whatsapp", to, success: true });
    if (invoice.status === "draft") invoice.status = "sent";
    const whatsappPaymentState = invoicePaymentState(invoice);
    invoice.amountPaid = whatsappPaymentState.amountPaid;
    invoice.balanceDue = whatsappPaymentState.balanceDue;
    await invoice.save();

    audit("invoice_delivery", {
      actor: req.admin?.email,
      invoiceNumber: invoice.invoiceNumber,
      channel: "whatsapp",
      result: "success",
    });

    res.json({ message: "Invoice sent on WhatsApp", to });
  } catch (err) {
    console.error(
      "WhatsApp send error:",
      err.response?.data?.error?.message || err.message
    );
    invoice.sentLog.push({ channel: "whatsapp", to, success: false, error: err.message });
    await invoice.save();

    audit("invoice_delivery", {
      actor: req.admin?.email,
      invoiceNumber: invoice.invoiceNumber,
      channel: "whatsapp",
      result: "failed",
    });

    const shareLink = buildWhatsAppShareLink({
      to,
      invoiceNumber: invoice.invoiceNumber,
      companyName: company?.name,
    });
    res.status(502).json({
      message: "WhatsApp Cloud API send failed",
      ...(process.env.NODE_ENV !== "production"
        ? { error: err.response?.data?.error?.message || err.message }
        : {}),
      shareLink,
    });
  }
};
