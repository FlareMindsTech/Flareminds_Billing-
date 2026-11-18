import mongoose from "mongoose";

const lineItemSchema = new mongoose.Schema(
  {
    description: { type: String, required: true },
    category: {
      type: String,
      default: "other",
    },
    quantity: { type: Number, default: 1 },
    rate: { type: Number, required: true },
    amount: { type: Number, required: true }, // quantity * rate, kept explicit for easy editing
    // Per-line GST / discount bookkeeping (server-computed for discounts/tax).
    taxPercent: { type: Number, default: 0, min: 0, max: 100 },
    hsnSac: { type: String, trim: true, default: "" },
    discountType: {
      type: String,
      enum: ["none", "percent", "amount"],
      default: "none",
    },
    discountValue: { type: Number, default: 0, min: 0 },
    discountAmount: { type: Number, default: 0 },
    taxableAmount: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    lineTotal: { type: Number, default: 0 },
    // Place of supply tax split for this line (CGST+SGST intra / IGST inter).
    taxType: { type: String, enum: ["cgst_sgst", "igst"], default: "cgst_sgst" },
    cgstAmount: { type: Number, default: 0 },
    sgstAmount: { type: Number, default: 0 },
    igstAmount: { type: Number, default: 0 },
    // Line item level dynamic custom fields (e.g. HSN code, batch, serial number)
    customFields: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  },
  { _id: false }
);

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true }, // e.g. FM-2026-0001 or ACME-2026-0001
    // Company reference for multi-company isolation
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", index: true },

    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true },
    date: { type: Date, required: true, default: Date.now },
    dueDate: { type: Date },

    lineItems: { type: [lineItemSchema], required: true, validate: (v) => v.length > 0 },

    subTotal: { type: Number, required: true },
    taxPercent: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    grandTotal: { type: Number, required: true },

    // Payment-derived fields. Both are recomputed from non-voided Payment
    // records whenever money is recorded or voided; clients never set them.
    amountPaid: { type: Number, default: 0 },
    balanceDue: { type: Number, default: 0 },

    // GST place of supply and split amounts (CGST+SGST intra-state,
    // IGST inter-state). Stored per invoice so old documents keep rendering.
    taxType: { type: String, enum: ["cgst_sgst", "igst"], default: "cgst_sgst" },
    cgstAmount: { type: Number, default: 0 },
    sgstAmount: { type: Number, default: 0 },
    igstAmount: { type: Number, default: 0 },

    notes: {
      type: String,
      default:
        "Your success is our mission. Thank you for choosing us for your marketing and software development needs — we're proud to be part of your journey.",
    },

    // Document-level customizable fields (e.g. PO Number, Project, Sales Rep, Academic Term)
    customFields: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },

    // Template used at creation. The snapshot freezes the layout/fields so
    // re-downloading an old invoice never changes its appearance.
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: "DocumentTemplate" },
    templateSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },

    status: {
      type: String,
      enum: ["draft", "sent", "partially_paid", "paid", "overdue", "cancelled"],
      default: "draft",
    },

    // Log of delivery attempts so the admin can see what's been sent and when
    sentLog: [
      {
        channel: { type: String, enum: ["email", "whatsapp"] },
        to: String,
        sentAt: { type: Date, default: Date.now },
        success: Boolean,
        error: String,
      },
    ],

    // Set only when this invoice was created by converting a quotation.
    sourceQuotation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Quotation",
      default: undefined,
    },
  },
  { timestamps: true }
);

invoiceSchema.index(
  { sourceQuotation: 1 },
  { unique: true, sparse: true, name: "uniq_invoice_source_quotation" }
);
invoiceSchema.index({ companyId: 1, createdAt: -1 });

export default mongoose.models.Invoice || mongoose.model("Invoice", invoiceSchema);
