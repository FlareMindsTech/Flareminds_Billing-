import mongoose from "mongoose";

// A quotation line item is deliberately product-agnostic: description,
// category and unit are free-text (with suggested values enforced only in the
// UI), so the same document works for software, hardware, courses,
// appliances, installation services or anything custom.
const lineItemSchema = new mongoose.Schema(
  {
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    category: { type: String, trim: true, default: "other", maxlength: 100 },
    itemType: { type: String, trim: true, default: "", maxlength: 100 },
    unit: { type: String, trim: true, default: "unit", maxlength: 50 },
    quantity: { type: Number, required: true, min: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
    discountType: {
      type: String,
      enum: ["none", "percent", "amount"],
      default: "none",
    },
    discountValue: { type: Number, default: 0, min: 0 },
    // Everything below is computed server-side; clients can never set it.
    discountAmount: { type: Number, default: 0 },
    taxPercent: { type: Number, default: 0, min: 0, max: 100 },
    taxAmount: { type: Number, default: 0 },
    lineTotal: { type: Number, required: true },
    // Line item level dynamic custom fields (e.g. HSN code, serial number, batch, etc.)
    customFields: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  },
  { _id: false }
);

// Historical copy of the client data at quotation time, so regenerating an
// old PDF stays accurate even after the client record is edited.
const clientSnapshotSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    company: { type: String, default: "" },
    address: { type: String, default: "" },
    email: { type: String, default: "" },
    whatsapp: { type: String, default: "" },
    phone: { type: String, default: "" },
    gstn: { type: String, default: "" },
  },
  { _id: false }
);

const quotationSchema = new mongoose.Schema(
  {
    quotationNumber: { type: String, required: true, unique: true }, // e.g. FM-QTN-2026-0001 or ACME-QTN-2026-0001
    // Company reference for multi-company isolation
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      index: true,
    },
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: true,
    },
    clientSnapshot: { type: clientSnapshotSchema, required: true },

    issueDate: { type: Date, required: true },
    validUntil: { type: Date, required: true },

    status: {
      type: String,
      enum: ["draft", "sent", "accepted", "rejected", "expired", "converted"],
      default: "draft",
    },

    lineItems: { type: [lineItemSchema], required: true, validate: (v) => v.length > 0 },

    // Financial summary - all values are computed on the server only.
    subTotal: { type: Number, required: true },
    discountTotal: { type: Number, default: 0 },
    taxTotal: { type: Number, default: 0 },
    shippingCharges: { type: Number, default: 0 },
    grandTotal: { type: Number, required: true },
    currency: { type: String, default: "INR", maxlength: 8 },

    notes: { type: String, default: "", maxlength: 3000 },
    termsAndConditions: { type: String, default: "", maxlength: 3000 },
    deliveryTimeline: { type: String, default: "", maxlength: 2000 },
    paymentTerms: { type: String, default: "", maxlength: 2000 },
    warrantyTerms: { type: String, default: "", maxlength: 2000 },
    exclusions: { type: String, default: "", maxlength: 2000 },

    // Document-level customizable fields (e.g. PO Number, Project, Sales Rep, Academic Term)
    customFields: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },

    // Frozen template config captured when the quotation is created.
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: "DocumentTemplate" },
    templateSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },

    // Accept/reject decisions recorded through the dedicated endpoints.
    acceptedAt: { type: Date },
    rejectedAt: { type: Date },
    decisionNote: { type: String, default: "", maxlength: 500 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },

    // Delivery attempts, same shape as Invoice.sentLog.
    sentLog: [
      {
        channel: { type: String, enum: ["email", "whatsapp"] },
        to: String,
        sentAt: { type: Date, default: Date.now },
        success: Boolean,
        error: String,
      },
    ],

    // Set only by the conversion endpoint, in the same transaction (or claim
    // + verify fallback) that creates the invoice. Server-owned.
    convertedInvoice: { type: mongoose.Schema.Types.ObjectId, ref: "Invoice" },
    conversionToken: { type: mongoose.Schema.Types.ObjectId, default: null, select: false },
  },
  { timestamps: true }
);

// Listing filters and lookups used by the API/UI.
quotationSchema.index({ status: 1, createdAt: -1 });
quotationSchema.index({ client: 1, createdAt: -1 });
quotationSchema.index({ companyId: 1, createdAt: -1 });
quotationSchema.index({ issueDate: -1 });
quotationSchema.index({ validUntil: 1, status: 1 });
quotationSchema.index({ createdAt: -1, _id: -1 });

export default mongoose.models.Quotation || mongoose.model("Quotation", quotationSchema);
