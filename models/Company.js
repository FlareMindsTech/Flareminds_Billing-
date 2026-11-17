import mongoose from "mongoose";

const bankSchema = new mongoose.Schema(
  {
    bankName: { type: String, trim: true, default: "" },
    accountName: { type: String, trim: true, default: "" },
    accountNumber: { type: String, trim: true, default: "" },
    ifsc: { type: String, trim: true, default: "" },
    branch: { type: String, trim: true, default: "" },
    upi: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

// Document-level custom field definition (e.g. "PO Number", "Project Code", "Sales Rep")
const customFieldDefinitionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 60 },
    label: { type: String, required: true, trim: true, maxlength: 100 },
    type: {
      type: String,
      enum: ["text", "number", "date", "select", "boolean"],
      default: "text",
    },
    options: { type: [String], default: [] },
    required: { type: Boolean, default: false },
    defaultValue: { type: mongoose.Schema.Types.Mixed, default: null },
    appliesTo: {
      type: String,
      enum: ["quotation", "invoice", "both"],
      default: "both",
    },
    showOnPdf: { type: Boolean, default: true },
  },
  { _id: false }
);

// Line-item level custom field definition (e.g. "HSN/SAC Code", "Serial Number", "Batch")
const itemCustomFieldDefinitionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 60 },
    label: { type: String, required: true, trim: true, maxlength: 100 },
    type: {
      type: String,
      enum: ["text", "number", "select"],
      default: "text",
    },
    options: { type: [String], default: [] },
    required: { type: Boolean, default: false },
    showOnPdf: { type: Boolean, default: true },
  },
  { _id: false }
);

// Customizable labels and titles allowing each company to rename headers and document jargon
const customLabelsSchema = new mongoose.Schema(
  {
    quotationTitle: { type: String, trim: true, default: "QUOTATION", maxlength: 60 },
    invoiceTitle: { type: String, trim: true, default: "TAX INVOICE", maxlength: 60 },
    clientSectionTitle: { type: String, trim: true, default: "QUOTATION FOR", maxlength: 60 },
    itemDescriptionLabel: { type: String, trim: true, default: "Description", maxlength: 50 },
    itemCategoryLabel: { type: String, trim: true, default: "Category", maxlength: 50 },
    itemUnitLabel: { type: String, trim: true, default: "Unit", maxlength: 50 },
    itemQuantityLabel: { type: String, trim: true, default: "Qty", maxlength: 50 },
    itemRateLabel: { type: String, trim: true, default: "Rate", maxlength: 50 },
    itemDiscountLabel: { type: String, trim: true, default: "Discount", maxlength: 50 },
    itemTaxLabel: { type: String, trim: true, default: "Tax", maxlength: 50 },
    itemAmountLabel: { type: String, trim: true, default: "Amount", maxlength: 50 },
    subTotalLabel: { type: String, trim: true, default: "Sub Total", maxlength: 50 },
    taxTotalLabel: { type: String, trim: true, default: "Tax", maxlength: 50 },
    grandTotalLabel: { type: String, trim: true, default: "Grand Total", maxlength: 50 },
    notesLabel: { type: String, trim: true, default: "Notes", maxlength: 50 },
    termsLabel: { type: String, trim: true, default: "Terms & Conditions", maxlength: 50 },
  },
  { _id: false }
);

const companySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 150 },
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      match: /^[A-Z0-9-]{2,20}$/,
    },
    tagline: { type: String, trim: true, default: "", maxlength: 300 },
    address: { type: String, trim: true, default: "", maxlength: 1000 },
    phone: { type: String, trim: true, default: "", maxlength: 50 },
    email: { type: String, trim: true, lowercase: true, default: "", maxlength: 200 },
    website: { type: String, trim: true, default: "", maxlength: 300 },
    gstn: { type: String, trim: true, default: "", maxlength: 50 },

    logoIconUrl: { type: String, trim: true, default: "", maxlength: 500000 },
    logoTextUrl: { type: String, trim: true, default: "", maxlength: 500000 },

    invoicePrefix: {
      type: String,
      trim: true,
      uppercase: true,
      default: "FM",
      maxlength: 20,
      match: /^[A-Z0-9-]{1,20}$/,
    },
    quotationPrefix: {
      type: String,
      trim: true,
      uppercase: true,
      default: "FM-QTN",
      maxlength: 20,
      match: /^[A-Z0-9-]{1,20}$/,
    },
    currency: { type: String, trim: true, uppercase: true, default: "INR", maxlength: 8 },
    defaultTaxPercent: { type: Number, default: 0, min: 0, max: 100 },

    defaultInvoiceNotes: { type: String, default: "", maxlength: 3000 },
    defaultQuotationNotes: { type: String, default: "", maxlength: 3000 },
    defaultTermsAndConditions: { type: String, default: "", maxlength: 3000 },
    defaultPaymentTerms: { type: String, default: "", maxlength: 2000 },
    defaultDeliveryTimeline: { type: String, default: "", maxlength: 2000 },
    defaultWarrantyTerms: { type: String, default: "", maxlength: 2000 },
    defaultExclusions: { type: String, default: "", maxlength: 2000 },

    bank: { type: bankSchema, default: () => ({}) },
    signatoryName: { type: String, trim: true, default: "", maxlength: 120 },
    signatoryTitle: { type: String, trim: true, default: "Authorised Signatory", maxlength: 120 },

    // Dynamic field customization per company
    customFields: { type: [customFieldDefinitionSchema], default: () => [] },
    itemCustomFields: { type: [itemCustomFieldDefinitionSchema], default: () => [] },
    customLabels: { type: customLabelsSchema, default: () => ({}) },

    // Lifecycle is owned by the platform superadmin.
    status: {
      type: String,
      enum: ["active", "suspended"],
      default: "active",
      index: true,
    },
    suspendedAt: { type: Date, default: null },
    suspendedReason: { type: String, trim: true, default: "", maxlength: 500 },
    suspendedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },

    // Deprecated: kept in sync with `status` for older clients/data.
    isActive: { type: Boolean, default: true },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

companySchema.index({ isDefault: 1 });
companySchema.index({ isActive: 1, createdAt: 1 });

export default mongoose.models.Company || mongoose.model("Company", companySchema);
