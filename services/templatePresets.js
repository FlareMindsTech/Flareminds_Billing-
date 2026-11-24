import { SECTION_KEYS } from "../models/DocumentTemplate.js";

const BASE_LABELS = {
  quotationTitle: "QUOTATION",
  invoiceTitle: "TAX INVOICE",
  clientSectionTitle: "BILL TO",
  itemDescriptionLabel: "Description",
  itemCategoryLabel: "Category",
  itemUnitLabel: "Unit",
  itemQuantityLabel: "Qty",
  itemRateLabel: "Rate",
  itemDiscountLabel: "Discount",
  itemTaxLabel: "Tax",
  itemAmountLabel: "Amount",
  subTotalLabel: "Sub Total",
  taxTotalLabel: "Tax",
  grandTotalLabel: "Grand Total",
  notesLabel: "Notes",
  termsLabel: "Terms & Conditions",
};

const SECTION_LABELS = {
  header: "Header",
  meta: "Document details",
  client: "Client details",
  items: "Line items",
  totals: "Totals",
  bank: "Bank details",
  notes: "Notes",
  terms: "Terms & conditions",
  signature: "Signature",
  footer: "Footer",
};

const DEFAULT_SECTIONS = {
  quotation: [
    "header",
    "meta",
    "client",
    "items",
    "totals",
    "notes",
    "terms",
    "signature",
    "footer",
  ],
  invoice: ["header", "meta", "client", "items", "totals", "bank", "notes", "footer"],
};

export function defaultSections(docType) {
  const keys = DEFAULT_SECTIONS[docType] || DEFAULT_SECTIONS.quotation;
  return keys.map((key, index) => ({
    key,
    label: SECTION_LABELS[key] || key,
    enabled: true,
    order: index,
  }));
}

export function allSectionKeys() {
  return [...SECTION_KEYS];
}

export function defaultLabels(docType, preset = "classic") {
  let quotationTitle = "QUOTATION";
  if (preset === "commercial-proposal") quotationTitle = "COMMERCIAL PROPOSAL";
  if (preset === "minimal-quotation") quotationTitle = "QUOTATION";
  if (preset === "medical-coding")
    quotationTitle = docType === "invoice" ? "FEE RECEIPT" : "COURSE PROPOSAL";
  return {
    ...BASE_LABELS,
    quotationTitle: docType === "invoice" ? "INVOICE" : quotationTitle,
    invoiceTitle:
      preset === "medical-coding" && docType === "invoice"
        ? "FEE RECEIPT"
        : "TAX INVOICE",
    clientSectionTitle: "BILL TO",
  };
}

export const PRESET_DOC_TYPES = {
  classic: ["quotation", "invoice"],
  modern: ["quotation", "invoice"],
  minimal: ["quotation", "invoice"],
  compact: ["quotation", "invoice"],
  "tax-invoice": ["invoice"],
  "gst-invoice": ["invoice"],
  proposal: ["quotation"],
  "commercial-proposal": ["quotation"],
  "premium-invoice": ["invoice"],
  "service-invoice": ["invoice"],
  "minimal-quotation": ["quotation"],
  "it-services": ["quotation", "invoice"],
  "medical-coding": ["quotation", "invoice"],
};

export function presetsForDocType(docType) {
  return Object.entries(PRESET_DOC_TYPES)
    .filter(([, types]) => types.includes(docType))
    .map(([key]) => key);
}

export function defaultLayout(overrides = {}) {
  const preset = overrides.preset || "classic";
  let presetStyle = {
    accentColor: "#4f46e5",
    secondaryColor: "#0f172a",
    fontFamily: "Helvetica",
    fontScale: 1,
    tableStyle: "bordered",
    margins: { top: 14, right: 14, bottom: 14, left: 14 },
  };

  if (preset === "modern") {
    presetStyle = {
      accentColor: "#0284c7",
      secondaryColor: "#0f172a",
      fontFamily: "Helvetica",
      fontScale: 1,
      tableStyle: "striped",
      margins: { top: 14, right: 14, bottom: 14, left: 14 },
    };
  } else if (preset === "minimal") {
    presetStyle = {
      accentColor: "#059669",
      secondaryColor: "#1e293b",
      fontFamily: "Arial",
      fontScale: 1,
      tableStyle: "minimal",
      margins: { top: 14, right: 14, bottom: 14, left: 14 },
    };
  } else if (preset === "compact") {
    presetStyle = {
      accentColor: "#6366f1",
      secondaryColor: "#1e1b4b",
      fontFamily: "Helvetica",
      fontScale: 0.9,
      tableStyle: "bordered",
      margins: { top: 10, right: 10, bottom: 10, left: 10 },
    };
  } else if (
    preset === "tax-invoice" ||
    preset === "gst-invoice" ||
    preset === "proposal" ||
    preset === "commercial-proposal"
  ) {
    presetStyle = {
      accentColor: preset.includes("proposal") ? "#0b7a6b" : "#00875a",
      secondaryColor: "#0f172a",
      fontFamily: "Arial",
      fontScale: 1,
      tableStyle: "bordered",
      margins: { top: 10, right: 10, bottom: 10, left: 10 },
    };
  } else if (preset === "premium-invoice") {
    presetStyle = {
      accentColor: "#b8860b",
      secondaryColor: "#0f172a",
      fontFamily: "Georgia",
      fontScale: 1,
      tableStyle: "striped",
      margins: { top: 14, right: 14, bottom: 14, left: 14 },
    };
  } else if (preset === "service-invoice") {
    presetStyle = {
      accentColor: "#2563eb",
      secondaryColor: "#1e293b",
      fontFamily: "Helvetica",
      fontScale: 1,
      tableStyle: "striped",
      margins: { top: 14, right: 14, bottom: 14, left: 14 },
    };
  } else if (preset === "minimal-quotation") {
    presetStyle = {
      accentColor: "#059669",
      secondaryColor: "#1e293b",
      fontFamily: "Arial",
      fontScale: 1,
      tableStyle: "minimal",
      margins: { top: 14, right: 14, bottom: 14, left: 14 },
    };
  } else if (preset === "it-services") {
    presetStyle = {
      accentColor: "#2563eb",
      secondaryColor: "#0f172a",
      fontFamily: "Helvetica",
      fontScale: 1,
      tableStyle: "striped",
      margins: { top: 14, right: 14, bottom: 14, left: 14 },
    };
  } else if (preset === "medical-coding") {
    presetStyle = {
      accentColor: "#0d9488",
      secondaryColor: "#1e293b",
      fontFamily: "Helvetica",
      fontScale: 1,
      tableStyle: "bordered",
      margins: { top: 14, right: 14, bottom: 14, left: 14 },
    };
  }

  return {
    preset,
    accentColor: presetStyle.accentColor,
    secondaryColor: presetStyle.secondaryColor,
    fontFamily: presetStyle.fontFamily,
    fontScale: presetStyle.fontScale,
    logoPosition: "left",
    showLogoText: true,
    showTagline: true,
    pageSize: "A4",
    orientation: "portrait",
    margins: presetStyle.margins,
    tableStyle: presetStyle.tableStyle,
    showPageNumbers: true,
    watermarkText: "",
    footerText: "",
    ...overrides,
  };
}

export function defaultCustomFields(docType) {
  if (docType === "invoice") {
    return [
      {
        key: "poNumber",
        label: "Purchase Order (PO) #",
        type: "text",
        required: false,
        placeholder: "e.g. PO-2026-0042",
        showOnPdf: true,
        order: 0,
      },
      {
        key: "paymentTerms",
        label: "Payment Terms",
        type: "select",
        options: ["Due on Receipt", "Net 15", "Net 30", "Net 45", "Net 60"],
        defaultValue: "Due on Receipt",
        required: false,
        showOnPdf: true,
        order: 1,
      },
      {
        key: "referenceNo",
        label: "Reference / Dispatch No.",
        type: "text",
        required: false,
        placeholder: "e.g. REF-8821",
        showOnPdf: true,
        order: 2,
      },
    ];
  }
  return [
    {
      key: "salesRep",
      label: "Prepared By",
      type: "text",
      required: false,
      placeholder: "e.g. Account Manager",
      showOnPdf: true,
      order: 0,
    },
    {
      key: "projectScope",
      label: "Project Scope",
      type: "text",
      required: false,
      placeholder: "e.g. Phase 1 Implementation",
      showOnPdf: true,
      order: 1,
    },
    {
      key: "estimatedTimeline",
      label: "Estimated Delivery",
      type: "text",
      required: false,
      placeholder: "e.g. 2-3 Weeks upon approval",
      showOnPdf: true,
      order: 2,
    },
  ];
}

export function defaultItemCustomFields(docType) {
  if (docType === "invoice") {
    return [
      {
        key: "hsnCode",
        label: "HSN / SAC",
        type: "text",
        required: false,
        placeholder: "e.g. 998313",
        showOnPdf: true,
        order: 0,
      },
    ];
  }
  return [
    {
      key: "deliverableScope",
      label: "Scope / Spec",
      type: "text",
      required: false,
      placeholder: "e.g. Deliverable breakdown",
      showOnPdf: true,
      order: 0,
    },
  ];
}

export function defaultContent(docType, preset = "classic") {
  const isProposal =
    isPreset(preset, ["proposal", "commercial-proposal"]) && docType !== "invoice";
  const isGst = isPreset(preset, ["tax-invoice", "gst-invoice"]);
  const isIt = preset === "it-services";

  const base = {
    subject: "",
    servicesBanner: "",
    signatoryName: "",
    signatoryTitle: "Authorised Signatory",
    closingText: "",
    noticeText: "",
    validityText: "15 Days",
    purposeText: "",
    scopeOfWork: [],
    processSteps: [],
    paymentMilestones: [],
    showGstBreakup: isGst || isIt,
    showAmountInWords: true,
    showBankDetails: true,
    showServicesBanner: false,
    showSignature: true,
    showPaymentSummary: true,
  };

  if (preset === "commercial-proposal" || preset === "proposal") {
    base.servicesBanner =
      "Supply, Installation & Commissioning of Grid-Connected Solar Power Systems";
    base.showServicesBanner = true;
  }

  if (isProposal) {
    base.subject = "";
    base.validityText = "30 Days";
    base.purposeText = "";
    base.closingText =
      "We hope the above offer suits your requirement and expect your valuable order at the earliest.";
    base.noticeText = "";
    base.scopeOfWork = [];
    base.processSteps = [];
    base.paymentMilestones = [];
  }

  return base;
}

function isPreset(value, list) {
  return list.includes(value);
}

export function buildDefaultTemplateConfig(
  docType,
  { name, preset = "classic", customFields = [], itemCustomFields = [], content } = {}
) {
  const type = docType === "invoice" ? "invoice" : "quotation";
  const isGst = isPreset(preset, ["tax-invoice", "gst-invoice"]);
  const isIt = preset === "it-services";

  // Preset-specific default document fields (optional, shown only when present).
  let resolvedCustomFields = Array.isArray(customFields) ? customFields : [];
  let resolvedItemCustomFields = Array.isArray(itemCustomFields)
    ? itemCustomFields
    : [];

  if (preset === "it-services") {
    if (resolvedCustomFields.length === 0) {
      resolvedCustomFields = [
        {
          key: "projectName",
          label: "Project Name",
          type: "text",
          required: false,
          placeholder: "e.g. Website Revamp",
          showOnPdf: true,
          order: 0,
        },
        {
          key: "poNumber",
          label: "PO Number",
          type: "text",
          required: false,
          placeholder: "e.g. PO-2026-0042",
          showOnPdf: true,
          order: 1,
        },
        {
          key: "paymentTerms",
          label: "Payment Terms",
          type: "select",
          options: ["Due on Receipt", "Net 15", "Net 30", "Net 45", "Net 60"],
          defaultValue: "Net 30",
          required: false,
          showOnPdf: true,
          order: 2,
        },
      ];
    }
    if (resolvedItemCustomFields.length === 0) {
      resolvedItemCustomFields = [
        {
          key: "sacCode",
          label: "SAC Code",
          type: "text",
          required: false,
          placeholder: "e.g. 998314",
          showOnPdf: true,
          order: 0,
        },
      ];
    }
  } else if (preset === "medical-coding") {
    if (resolvedCustomFields.length === 0) {
      resolvedCustomFields = [
        {
          key: "studentId",
          label: "Student ID",
          type: "text",
          required: false,
          placeholder: "e.g. STU-1001",
          showOnPdf: true,
          order: 0,
        },
        {
          key: "courseName",
          label: "Course Name",
          type: "text",
          required: false,
          placeholder: "e.g. Medical Coding Professional",
          showOnPdf: true,
          order: 1,
        },
        {
          key: "batchDuration",
          label: "Batch / Duration",
          type: "text",
          required: false,
          placeholder: "e.g. Batch A - 6 Months",
          showOnPdf: true,
          order: 2,
        },
      ];
    }
  }

  return {
    docType: type,
    name: name || (type === "invoice" ? "Standard Invoice" : "Standard Quotation"),
    code: type === "invoice" ? "INVOICE-STANDARD" : "QUOTATION-STANDARD",
    description: `Professional ${preset} layout for ${type}s.`,
    isDefault: true,
    isActive: true,
    isSystem: false,
    layout: defaultLayout({ preset }),
    sections: defaultSections(type),
    columns: {
      category: true,
      itemType: type === "quotation",
      unit: type === "quotation" || isGst || isIt,
      discount: type === "quotation",
      tax: type === "quotation" || isGst || isIt,
      customFields: isIt ? ["sacCode"] : [],
    },
    customFields: resolvedCustomFields,
    itemCustomFields: resolvedItemCustomFields,
    labels: defaultLabels(type, preset),
    content: { ...defaultContent(type, preset), ...(content || {}) },
  };
}

export const PRESET_META = [
  {
    key: "classic",
    name: "Classic",
    description: "Clean bordered layout with a strong document header.",
    docTypes: ["quotation", "invoice"],
  },
  {
    key: "modern",
    name: "Modern",
    description: "Accent-coloured header and airy spacing.",
    docTypes: ["quotation", "invoice"],
  },
  {
    key: "minimal",
    name: "Minimal",
    description: "Typography-first, borderless tables.",
    docTypes: ["quotation", "invoice"],
  },
  {
    key: "compact",
    name: "Compact",
    description: "Dense layout for long item lists.",
    docTypes: ["quotation", "invoice"],
  },
  {
    key: "tax-invoice",
    name: "GST Tax Invoice (Legacy)",
    description: "Legacy alias of the GST tax invoice design.",
    docTypes: ["invoice"],
    legacy: true,
  },
  {
    key: "gst-invoice",
    name: "GST Tax Invoice",
    description:
      "Official Indian GST Tax Invoice format with HSN/SAC, CGST/SGST breakup, amount in words, bank and signatory cards.",
    docTypes: ["invoice"],
  },
  {
    key: "proposal",
    name: "Commercial Proposal (Legacy)",
    description: "Legacy alias of the three-page commercial proposal.",
    docTypes: ["quotation"],
    legacy: true,
  },
  {
    key: "commercial-proposal",
    name: "Commercial Proposal",
    description:
      "Three-page commercial proposal with quotation summary, terms, scope of work, payment milestones and execution process.",
    docTypes: ["quotation"],
  },
  {
    key: "premium-invoice",
    name: "Premium Corporate Invoice",
    description:
      "Executive invoice with a dark masthead, refined typography and a strong totals block.",
    docTypes: ["invoice"],
  },
  {
    key: "service-invoice",
    name: "Service & Retail Invoice",
    description:
      "Clear service invoice with highlighted service period, compact item table and payment summary.",
    docTypes: ["invoice"],
  },
  {
    key: "minimal-quotation",
    name: "Modern Minimal Quotation",
    description:
      "Light, typography-led quotation with generous whitespace and a crisp totals panel.",
    docTypes: ["quotation"],
  },
  {
    key: "it-services",
    name: "IT & Software Services",
    description:
      "Clean corporate layout for IT agencies and SaaS: SAC codes, service deliverables, Qty/Units, Rate, GST breakup, PO/Project/Payment Terms, bank & signatory.",
    docTypes: ["quotation", "invoice"],
  },
  {
    key: "medical-coding",
    name: "Medical Coding Institute",
    description:
      "Institutional fee receipt and course proposal layout with Student ID, Course, Batch/Duration and payment summary (Total Fee / Paid / Balance Due).",
    docTypes: ["quotation", "invoice"],
  },
];
