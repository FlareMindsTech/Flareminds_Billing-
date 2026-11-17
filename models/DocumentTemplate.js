import mongoose from "mongoose";

export const DOCUMENT_TYPES = ["quotation", "invoice"];
export const TEMPLATE_PRESETS = [
  "classic",
  "modern",
  "minimal",
  "compact",
  "tax-invoice",
  "proposal",
  "gst-invoice",
  "commercial-proposal",
  "premium-invoice",
  "service-invoice",
  "minimal-quotation",
];
export const SECTION_KEYS = [
  "header",
  "meta",
  "client",
  "items",
  "totals",
  "bank",
  "notes",
  "terms",
  "signature",
  "footer",
];

const documentFieldSchema = new mongoose.Schema(
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
    showOnPdf: { type: Boolean, default: true },
  },
  { _id: false }
);

const itemFieldSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, maxlength: 60 },
    label: { type: String, required: true, trim: true, maxlength: 100 },
    type: { type: String, enum: ["text", "number", "select"], default: "text" },
    options: { type: [String], default: [] },
    required: { type: Boolean, default: false },
    showOnPdf: { type: Boolean, default: true },
  },
  { _id: false }
);

const sectionSchema = new mongoose.Schema(
  {
    key: { type: String, enum: SECTION_KEYS, required: true },
    label: { type: String, trim: true, default: "", maxlength: 100 },
    enabled: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

const layoutSchema = new mongoose.Schema(
  {
    preset: { type: String, enum: TEMPLATE_PRESETS, default: "classic" },
    accentColor: { type: String, default: "#4f46e5", maxlength: 20 },
    secondaryColor: { type: String, default: "#0f172a", maxlength: 20 },
    fontFamily: {
      type: String,
      enum: ["Helvetica", "Arial", "Georgia", "Times New Roman"],
      default: "Helvetica",
    },
    fontScale: { type: Number, default: 1, min: 0.8, max: 1.3 },
    logoPosition: { type: String, enum: ["left", "center", "right"], default: "left" },
    showLogoText: { type: Boolean, default: true },
    showTagline: { type: Boolean, default: true },
    pageSize: { type: String, enum: ["A4", "Letter"], default: "A4" },
    orientation: { type: String, enum: ["portrait", "landscape"], default: "portrait" },
    margins: {
      top: { type: Number, default: 14, min: 0, max: 60 },
      right: { type: Number, default: 14, min: 0, max: 60 },
      bottom: { type: Number, default: 14, min: 0, max: 60 },
      left: { type: Number, default: 14, min: 0, max: 60 },
    },
    tableStyle: {
      type: String,
      enum: ["bordered", "striped", "minimal"],
      default: "bordered",
    },
    showPageNumbers: { type: Boolean, default: true },
    watermarkText: { type: String, default: "", maxlength: 120 },
    footerText: { type: String, default: "", maxlength: 300 },
  },
  { _id: false }
);

const columnsSchema = new mongoose.Schema(
  {
    category: { type: Boolean, default: true },
    itemType: { type: Boolean, default: false },
    unit: { type: Boolean, default: true },
    discount: { type: Boolean, default: true },
    tax: { type: Boolean, default: true },
    customFields: { type: [String], default: [] },
  },
  { _id: false }
);

const labelsSchema = new mongoose.Schema(
  {
    quotationTitle: { type: String, default: "QUOTATION", maxlength: 60 },
    invoiceTitle: { type: String, default: "TAX INVOICE", maxlength: 60 },
    clientSectionTitle: { type: String, default: "BILL TO", maxlength: 60 },
    itemDescriptionLabel: { type: String, default: "Description", maxlength: 50 },
    itemCategoryLabel: { type: String, default: "Category", maxlength: 50 },
    itemUnitLabel: { type: String, default: "Unit", maxlength: 50 },
    itemQuantityLabel: { type: String, default: "Qty", maxlength: 50 },
    itemRateLabel: { type: String, default: "Rate", maxlength: 50 },
    itemDiscountLabel: { type: String, default: "Discount", maxlength: 50 },
    itemTaxLabel: { type: String, default: "Tax", maxlength: 50 },
    itemAmountLabel: { type: String, default: "Amount", maxlength: 50 },
    subTotalLabel: { type: String, default: "Sub Total", maxlength: 50 },
    taxTotalLabel: { type: String, default: "Tax", maxlength: 50 },
    grandTotalLabel: { type: String, default: "Grand Total", maxlength: 50 },
    notesLabel: { type: String, default: "Notes", maxlength: 50 },
    termsLabel: { type: String, default: "Terms & Conditions", maxlength: 50 },
  },
  { _id: false }
);

const processStepSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, default: "", maxlength: 120 },
    description: { type: String, trim: true, default: "", maxlength: 1000 },
  },
  { _id: false }
);

const paymentMilestoneSchema = new mongoose.Schema(
  {
    label: { type: String, trim: true, default: "", maxlength: 120 },
    percentage: { type: Number, default: 0, min: 0, max: 100 },
    description: { type: String, trim: true, default: "", maxlength: 500 },
  },
  { _id: false }
);

const contentSchema = new mongoose.Schema(
  {
    subject: { type: String, trim: true, default: "", maxlength: 200 },
    servicesBanner: { type: String, trim: true, default: "", maxlength: 300 },
    signatoryName: { type: String, trim: true, default: "", maxlength: 120 },
    signatoryTitle: { type: String, trim: true, default: "", maxlength: 120 },
    closingText: { type: String, trim: true, default: "", maxlength: 600 },
    noticeText: { type: String, trim: true, default: "", maxlength: 600 },
    validityText: { type: String, trim: true, default: "", maxlength: 200 },
    purposeText: { type: String, trim: true, default: "", maxlength: 600 },
    scopeOfWork: { type: [String], default: [] },
    processSteps: { type: [processStepSchema], default: [] },
    paymentMilestones: { type: [paymentMilestoneSchema], default: [] },
    showGstBreakup: { type: Boolean, default: true },
    showAmountInWords: { type: Boolean, default: true },
    showBankDetails: { type: Boolean, default: true },
    showServicesBanner: { type: Boolean, default: true },
    showSignature: { type: Boolean, default: true },
    showPaymentSummary: { type: Boolean, default: true },
  },
  { _id: false }
);

const documentTemplateSchema = new mongoose.Schema(
  {
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      default: null,
      index: true,
    },
    docType: { type: String, enum: DOCUMENT_TYPES, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    code: { type: String, trim: true, uppercase: true, maxlength: 40, default: "" },
    description: { type: String, trim: true, default: "", maxlength: 500 },
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    // System presets are owned by the platform and cloned into companies.
    isSystem: { type: Boolean, default: false },
    version: { type: Number, default: 1 },

    layout: { type: layoutSchema, default: () => ({}) },
    sections: { type: [sectionSchema], default: () => [] },
    columns: { type: columnsSchema, default: () => ({}) },
    customFields: { type: [documentFieldSchema], default: () => [] },
    itemCustomFields: { type: [itemFieldSchema], default: () => [] },
    labels: { type: labelsSchema, default: () => ({}) },
    content: { type: contentSchema, default: () => ({}) },
    sourceSystemTemplateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DocumentTemplate",
      default: null,
      index: true,
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
  },
  { timestamps: true }
);

documentTemplateSchema.index({ companyId: 1, docType: 1, isActive: 1 });
documentTemplateSchema.index({ companyId: 1, docType: 1, createdAt: 1 });
documentTemplateSchema.index(
  { companyId: 1, docType: 1, isDefault: 1 },
  {
    unique: true,
    partialFilterExpression: { isDefault: true, companyId: { $type: "objectId" } },
    name: "uniq_default_template_per_company_type",
  }
);

export default mongoose.models.DocumentTemplate ||
  mongoose.model("DocumentTemplate", documentTemplateSchema);
