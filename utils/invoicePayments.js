// Shared money/status rules for invoice payments. Kept free of model imports so
// controllers, PDF rendering and serialization all agree on the same numbers.

export const PAYABLE_INVOICE_STATUSES = ["sent", "partially_paid", "overdue"];

// Money is stored as a Number but always normalized to 2 decimals at the
// boundary so 0.1 + 0.2 never leaks into invoices, balances or API responses.
export function roundMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round((number + Math.sign(number) * Number.EPSILON) * 100) / 100;
}

export function startOfToday(now = new Date()) {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date;
}

// Status precedence: paid (nothing left) -> partially_paid (some money in)
// -> overdue (nothing paid and the due date has passed) -> sent.
// Draft and cancelled invoices keep their explicit status so payments can never
// silently revive them.
export function deriveInvoiceStatus(invoice, amountPaid, balanceDue, now = new Date()) {
  const currentStatus = invoice?.status;
  if (currentStatus === "cancelled") return "cancelled";
  if (currentStatus === "draft") return "draft";

  if (roundMoney(balanceDue) <= 0) return "paid";
  if (roundMoney(amountPaid) > 0) return "partially_paid";

  const dueDate = invoice?.dueDate ? new Date(invoice.dueDate) : null;
  if (
    dueDate &&
    !Number.isNaN(dueDate.getTime()) &&
    dueDate.getTime() < startOfToday(now).getTime()
  ) {
    return "overdue";
  }

  return "sent";
}

// Derived values for API responses and PDFs. Invoices created before payments
// existed have no amountPaid field; Mongoose applies the 0 default when it
// hydrates those rows, so a "paid" status with nothing recorded is treated as
// fully paid. This stops old documents from suddenly becoming outstanding.
export function invoicePaymentState(invoice, now = new Date()) {
  const grandTotal = roundMoney(invoice?.grandTotal ?? 0);
  const storedPaid = roundMoney(invoice?.amountPaid ?? 0);
  const legacyMarkedPaid = invoice?.status === "paid" && storedPaid <= 0;
  const amountPaid = roundMoney(legacyMarkedPaid ? grandTotal : storedPaid);
  const balanceDue = roundMoney(Math.max(0, grandTotal - amountPaid));
  const status = deriveInvoiceStatus(invoice, amountPaid, balanceDue, now);

  return { amountPaid, balanceDue, status, legacyMarkedPaid };
}

// Returns a plain object with the effective values, suitable for res.json() or
// for rendering. The stored document is left untouched (overdue is computed on
// read, like quotation expiry).
export function withEffectivePaymentFields(invoice, now = new Date()) {
  const state = invoicePaymentState(invoice, now);
  const plainInvoice =
    typeof invoice?.toObject === "function" ? invoice.toObject() : { ...(invoice || {}) };

  plainInvoice.amountPaid = state.amountPaid;
  plainInvoice.balanceDue = state.balanceDue;
  plainInvoice.status = state.status;

  return plainInvoice;
}

// Recomputes the persisted invoice totals from the supplied non-voided
// payments. Returns the previous status so callers can write audit entries.
export function applyInvoicePaymentState(invoice, payments = [], now = new Date()) {
  const grandTotal = roundMoney(invoice?.grandTotal ?? 0);
  const amountPaid = roundMoney(
    payments.reduce((sum, payment) => sum + Number(payment?.amount || 0), 0)
  );
  const balanceDue = roundMoney(Math.max(0, grandTotal - amountPaid));
  const previousStatus = invoice?.status;
  const status = deriveInvoiceStatus(invoice, amountPaid, balanceDue, now);

  invoice.amountPaid = amountPaid;
  invoice.balanceDue = balanceDue;
  invoice.status = status;

  return { amountPaid, balanceDue, status, previousStatus };
}

export function isInvoicePayable(invoice, now = new Date()) {
  const state = invoicePaymentState(invoice, now);
  return PAYABLE_INVOICE_STATUSES.includes(state.status) && state.balanceDue > 0;
}
