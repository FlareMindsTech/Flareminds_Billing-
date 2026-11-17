import mongoose from "mongoose";

// Payment methods accepted when recording money against an invoice.
export const PAYMENT_METHODS = [
  "cash",
  "upi",
  "bank_transfer",
  "cheque",
  "card",
  "other",
];

const paymentSchema = new mongoose.Schema(
  {
    // Company reference mirrors the invoice and keeps every query tenant-scoped.
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: true,
      index: true,
    },
    invoiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Invoice",
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: [0.01, "Payment amount must be greater than 0"],
    },
    paidOn: { type: Date, required: true, default: Date.now },
    method: {
      type: String,
      enum: PAYMENT_METHODS,
      default: "other",
      required: true,
    },
    reference: { type: String, trim: true, maxlength: 200, default: "" },
    notes: { type: String, trim: true, maxlength: 2000, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },

    // Payments are never hard-deleted. Voiding keeps the audit trail while
    // removing the amount from the invoice balance.
    voided: { type: Boolean, default: false },
    voidReason: { type: String, trim: true, maxlength: 500, default: "" },
  },
  { timestamps: true }
);

// Primary access pattern: list all payments for one invoice inside a company.
paymentSchema.index({ companyId: 1, invoiceId: 1 });

export default mongoose.models.Payment || mongoose.model("Payment", paymentSchema);
