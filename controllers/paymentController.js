import mongoose from "mongoose";
import Invoice from "../models/Invoice.js";
import Payment, { PAYMENT_METHODS } from "../models/Payment.js";
import { recomputeInvoicePaymentState } from "../services/invoicePaymentService.js";
import {
  deriveInvoiceStatus,
  invoicePaymentState,
  roundMoney,
  withEffectivePaymentFields,
} from "../utils/invoicePayments.js";
import {
  buildMonthBuckets,
  summarizeCollections,
} from "../utils/collectionSummary.js";
import { audit } from "../utils/auditLog.js";

const isBadId = (id) => !mongoose.isValidObjectId(id);
const tenantId = (req) =>
  req.companyId || req.company?._id || req.admin?.companyId || null;

// Optimistic-concurrency retries. A conflicting update simply re-reads the
// invoice and validates the new balance again.
const MAX_PAYMENT_ATTEMPTS = 5;

const text = (value, max) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const paymentPayload = (payment, invoice) => {
  const plainPayment = payment.toObject();
  return {
    ...plainPayment,
    payment: plainPayment,
    invoice: withEffectivePaymentFields(invoice),
  };
};

export const listInvoicePayments = async (req, res) => {
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
  }).select("_id");
  if (!invoice) return res.status(404).json({ message: "Invoice not found" });

  const payments = await Payment.find({
    companyId,
    invoiceId: invoice._id,
  })
    .populate("createdBy", "name email")
    .sort({ paidOn: -1, createdAt: -1 });

  res.json(payments);
};

export const recordInvoicePayment = async (req, res) => {
  const companyId = tenantId(req);
  if (!companyId) {
    return res.status(409).json({ message: "No active company is configured" });
  }
  if (isBadId(req.params.id)) {
    return res.status(404).json({ message: "Invoice not found" });
  }

  const body = req.body || {};
  const amount = roundMoney(body.amount);
  if (!Number.isFinite(Number(body.amount)) || amount <= 0) {
    return res.status(400).json({ message: "Payment amount must be greater than 0" });
  }

  const method =
    body.method === undefined || body.method === null || body.method === ""
      ? "other"
      : String(body.method);
  if (!PAYMENT_METHODS.includes(method)) {
    return res.status(400).json({ message: "Invalid payment method" });
  }

  if (body.reference !== undefined && typeof body.reference !== "string") {
    return res.status(400).json({ message: "Payment reference must be text" });
  }
  if (body.notes !== undefined && typeof body.notes !== "string") {
    return res.status(400).json({ message: "Payment notes must be text" });
  }

  const paidOn = body.paidOn ? new Date(body.paidOn) : new Date();
  if (Number.isNaN(paidOn.getTime())) {
    return res.status(400).json({ message: "Payment date is not a valid date" });
  }

  const amountInCents = Math.round(amount * 100);
  let invoice = null;
  let previousStatus = null;
  let previousPaid = 0;

  for (let attempt = 0; attempt < MAX_PAYMENT_ATTEMPTS; attempt += 1) {
    const current = await Invoice.findOne({
      _id: req.params.id,
      companyId,
    });
    if (!current) return res.status(404).json({ message: "Invoice not found" });

    if (current.status === "paid") {
      return res.status(409).json({ message: "This invoice is already fully paid" });
    }
    if (current.status === "draft" || current.status === "cancelled") {
      return res.status(409).json({
        message: "Payments can only be recorded on sent, partially paid or overdue invoices",
      });
    }
    if (!["sent", "partially_paid", "overdue"].includes(current.status)) {
      return res.status(409).json({ message: "This invoice cannot accept payments" });
    }

    const state = invoicePaymentState(current);
    if (state.balanceDue <= 0) {
      return res.status(409).json({ message: "This invoice is already fully paid" });
    }

    const balanceInCents = Math.round(state.balanceDue * 100);
    if (amountInCents > balanceInCents) {
      return res.status(400).json({
        message: "Payment amount exceeds the outstanding balance",
      });
    }

    const nextPaid = roundMoney(state.amountPaid + amount);
    const nextBalance = roundMoney(
      Math.max(0, Number(current.grandTotal || 0) - nextPaid)
    );
    const nextStatus = deriveInvoiceStatus(current, nextPaid, nextBalance);

    // The $expr guard makes the read/validate/write cycle safe even when two
    // payments for the same invoice arrive at the same time: only one write can
    // match the amountPaid value that was read.
    const updated = await Invoice.findOneAndUpdate(
      {
        _id: current._id,
        companyId,
        status: { $in: ["sent", "partially_paid", "overdue"] },
        $expr: {
          $eq: [{ $round: [{ $ifNull: ["$amountPaid", 0] }, 2] }, state.amountPaid],
        },
      },
      {
        $set: {
          amountPaid: nextPaid,
          balanceDue: nextBalance,
          status: nextStatus,
        },
      },
      { new: true }
    );

    if (updated) {
      invoice = updated;
      previousStatus = current.status;
      previousPaid = state.amountPaid;
      break;
    }
  }

  if (!invoice) {
    return res.status(409).json({
      message: "Payment could not be applied because the invoice changed. Please try again.",
    });
  }

  let payment;
  try {
    payment = await Payment.create({
      companyId,
      invoiceId: invoice._id,
      amount,
      paidOn,
      method,
      reference: text(body.reference, 200),
      notes: text(body.notes, 2000),
      ...(req.admin?._id ? { createdBy: req.admin._id } : {}),
    });
  } catch (err) {
    // The invoice claim happened first; if the payment record cannot be
    // written, rebuild the invoice from its existing payments so no phantom
    // amount remains.
    console.error("Record payment error:", err.message);
    try {
      await recomputeInvoicePaymentState({
        invoiceId: invoice._id,
        companyId,
      });
    } catch (rollbackError) {
      console.error("Payment rollback error:", rollbackError.message);
    }
    return res.status(500).json({ message: "Failed to record payment" });
  }

  audit("invoice_payment_recorded", {
    actor: req.admin?.email,
    companyId: String(companyId),
    invoiceId: String(invoice._id),
    invoiceNumber: invoice.invoiceNumber,
    paymentId: String(payment._id),
    amount,
    method,
    previousPaid,
  });

  if (previousStatus !== invoice.status) {
    audit("invoice_status_changed", {
      actor: req.admin?.email,
      companyId: String(companyId),
      invoiceId: String(invoice._id),
      invoiceNumber: invoice.invoiceNumber,
      from: previousStatus,
      to: invoice.status,
      source: "payment",
    });
  }

  res.status(201).json(paymentPayload(payment, invoice));
};

export const voidInvoicePayment = async (req, res) => {
  const companyId = tenantId(req);
  if (!companyId) {
    return res.status(409).json({ message: "No active company is configured" });
  }
  if (isBadId(req.params.id) || isBadId(req.params.paymentId)) {
    return res.status(404).json({ message: "Payment not found" });
  }

  const invoice = await Invoice.findOne({
    _id: req.params.id,
    companyId,
  });
  if (!invoice) return res.status(404).json({ message: "Invoice not found" });

  const reason = text(req.body?.voidReason, 500);
  if (reason.length < 3) {
    return res
      .status(400)
      .json({ message: "Void reason must be at least 3 characters" });
  }

  const payment = await Payment.findOneAndUpdate(
    {
      _id: req.params.paymentId,
      invoiceId: invoice._id,
      companyId,
      voided: false,
    },
    { $set: { voided: true, voidReason: reason } },
    { new: true }
  );

  if (!payment) {
    const existing = await Payment.findOne({
      _id: req.params.paymentId,
      invoiceId: invoice._id,
      companyId,
    });
    if (!existing) return res.status(404).json({ message: "Payment not found" });
    return res.status(409).json({ message: "Payment is already voided" });
  }

  let recomputed;
  try {
    recomputed = await recomputeInvoicePaymentState({
      invoiceId: invoice._id,
      companyId,
    });
  } catch (err) {
    console.error("Void payment recompute error:", err.message);
    return res.status(500).json({ message: "Payment voided but invoice totals could not be updated" });
  }

  if (!recomputed) {
    return res.status(404).json({ message: "Invoice not found" });
  }

  audit("invoice_payment_voided", {
    actor: req.admin?.email,
    companyId: String(companyId),
    invoiceId: String(invoice._id),
    invoiceNumber: invoice.invoiceNumber,
    paymentId: String(payment._id),
    amount: payment.amount,
    method: payment.method,
    voidReason: reason,
  });

  if (recomputed.previousStatus !== recomputed.status) {
    audit("invoice_status_changed", {
      actor: req.admin?.email,
      companyId: String(companyId),
      invoiceId: String(invoice._id),
      invoiceNumber: invoice.invoiceNumber,
      from: recomputed.previousStatus,
      to: recomputed.status,
      source: "payment_void",
    });
  }

  res.json(paymentPayload(payment, recomputed.invoice));
};

// Dashboard totals: all money collected from non-voided payments, plus legacy
// paid invoices that never got Payment records. The monthly series is
// zero-filled for the last six months so the chart always has an axis.
export const getCollectionSummary = async (req, res) => {
  const companyId = tenantId(req);
  if (!companyId) {
    return res.status(409).json({ message: "No active company is configured" });
  }

  const now = new Date();
  const buckets = buildMonthBuckets(now);
  const from = buckets[0].start;
  const to = buckets[buckets.length - 1].end;

  const [payments, paidInvoices, paymentInvoiceIds] = await Promise.all([
    Payment.find({ companyId, voided: false })
      .populate("invoiceId", "exchangeRate")
      .select("amount paidOn createdAt invoiceId")
      .lean(),
    Invoice.find({ companyId, status: "paid" }).lean(),
    Payment.distinct("invoiceId", { companyId }),
  ]);

  const invoicesWithPayments = new Set(
    paymentInvoiceIds.map((invoiceId) => String(invoiceId))
  );
  const legacyInvoices = paidInvoices.filter(
    (invoice) => !invoicesWithPayments.has(String(invoice._id))
  );

  // Convert foreign-currency amounts to the company's base currency.
  for (const payment of payments) {
    const rate = Number(payment?.invoiceId?.exchangeRate || 1);
    if (rate && rate !== 1) payment.amount = Number(payment.amount || 0) * rate;
  }
  for (const invoice of legacyInvoices) {
    const rate = Number(invoice?.exchangeRate || 1);
    if (rate && rate !== 1) {
      invoice.grandTotal = Number(invoice.grandTotal || 0) * rate;
      invoice.amountPaid = Number(invoice.amountPaid || 0) * rate;
    }
  }

  const summary = summarizeCollections({ payments, legacyInvoices, now });

  res.json({
    ...summary,
    range: { from: from.toISOString(), to: to.toISOString() },
  });
};
