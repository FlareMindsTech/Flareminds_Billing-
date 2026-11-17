import Invoice from "../models/Invoice.js";
import Payment from "../models/Payment.js";
import { applyInvoicePaymentState } from "../utils/invoicePayments.js";

// Rebuilds the invoice's amountPaid/balanceDue/status from the source of
// truth: all non-voided payments. Called after recording or voiding a payment.
export async function recomputeInvoicePaymentState({
  invoice = null,
  invoiceId,
  companyId,
  now = new Date(),
}) {
  const target =
    invoice || (await Invoice.findOne({ _id: invoiceId, companyId }));

  if (!target) return null;

  const payments = await Payment.find({
    companyId: target.companyId || companyId,
    invoiceId: target._id,
    voided: false,
  })
    .select("amount")
    .lean();

  const result = applyInvoicePaymentState(target, payments, now);
  await target.save();

  return { invoice: target, ...result };
}
