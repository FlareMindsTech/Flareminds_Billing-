// Shared money/status rules for invoice payments. Kept free of model imports so
// controllers, PDF rendering and serialization all agree on the same numbers.

export const PAYABLE_INVOICE_STATUSES = ["sent", "partially_paid", "overdue"];

// A partially paid invoice keeps its status, but it is still overdue once the
// remaining balance passes its due date. This flag is derived on read so the
// stored status never has to lie about both facts at once.
export const NON_OVERDUE_STATUSES = ["draft", "cancelled", "paid"];

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

// True when money is still owed after the due date, regardless of whether the
// invoice is sent, overdue or partially_paid. Draft, cancelled and paid
// invoices are never considered overdue.
export function isInvoiceOverdue(invoice, balanceDue, now = new Date()) {
  const status = invoice?.status;
  if (NON_OVERDUE_STATUSES.includes(status)) return false;
  if (roundMoney(balanceDue ?? invoice?.balanceDue ?? 0) <= 0) return false;

  const dueDate = invoice?.dueDate ? new Date(invoice.dueDate) : null;
  if (!dueDate || Number.isNaN(dueDate.getTime())) return false;

  return dueDate.getTime() < startOfToday(now).getTime();
}

// Human-readable status for documents: "partially_paid" -> "Partially Paid".
export function invoiceStatusLabel(status) {
  const text = String(status || "").trim();
  if (!text) return "Draft";
  return text
    .replace(/_/g, " ")
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
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
  const isOverdue = isInvoiceOverdue(
    { status, dueDate: invoice?.dueDate },
    balanceDue,
    now
  );

  return { amountPaid, balanceDue, status, isOverdue, legacyMarkedPaid };
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
  plainInvoice.isOverdue = state.isOverdue;

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
  const isOverdue = isInvoiceOverdue(
    { status, dueDate: invoice?.dueDate },
    balanceDue,
    now
  );

  invoice.amountPaid = amountPaid;
  invoice.balanceDue = balanceDue;
  invoice.status = status;

  return { amountPaid, balanceDue, status, isOverdue, previousStatus };
}

export function isInvoicePayable(invoice, now = new Date()) {
  const state = invoicePaymentState(invoice, now);
  return PAYABLE_INVOICE_STATUSES.includes(state.status) && state.balanceDue > 0;
}
