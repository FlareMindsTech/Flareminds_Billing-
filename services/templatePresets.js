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
  return {
    ...BASE_LABELS,
    quotationTitle: docType === "invoice" ? "INVOICE" : quotationTitle,
    invoiceTitle: "TAX INVOICE",
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

  const base = {
    subject: "",
    servicesBanner:
      "Supply, Installation & Commissioning of Grid-Connected Solar Power Systems",
    signatoryName: "",
    signatoryTitle: "Authorised Signatory",
    closingText: "",
    noticeText: "",
    validityText: "15 Days",
    purposeText: "",
    scopeOfWork: [],
    processSteps: [],
    paymentMilestones: [],
    showGstBreakup: isGst,
    showAmountInWords: true,
    showBankDetails: true,
    showServicesBanner: isGst || isProposal,
    showSignature: true,
    showPaymentSummary: true,
  };

  if (isProposal) {
    base.subject = "3KW Solar On-Grid System for Domestic";
    base.validityText = "30 Days";
    base.purposeText =
      "We are pleased to submit our detailed commercial proposal for the design, supply, installation and commissioning of the proposed solar power system.";
    base.closingText =
      "We hope the above offer suits your requirement and expect your valuable order at the earliest.";
    base.noticeText =
      "For a 3KW solar system, the Central Government subsidy is Rs.78,000/- and the Tamil Nadu Government subsidy is Rs.22,000/-, making the total subsidy amount Rs.1,00,000/-. The subsidy amount will be credited directly to the customer's bank account.\n\nSince the proposed solar capacity is above the existing EB sanctioned load, the TNEB sanctioned load enhancement process and applicable charges shall be under the customer's scope.\n\nThe quoted amount covers only the specified scope of work. Any additional work requested or required will be charged separately.";
    base.scopeOfWork = [
      "Site Visit",
      "Unloading",
      "Lifting",
      "AC Earth",
      "DC Earth",
      "Lightning Arrester",
      "Customized Structure Work",
      "Panel Installation",
      "Cable Laying",
      "Net Meter Payment",
      "Commissioning",
      "System Configuration (After Net Meter Connection)",
      "Five Years Free Service",
    ];
    base.processSteps = [
      {
        title: "Site Visit",
        description:
          "We visit the site to check space availability, roof strength, and electrical setup. This helps us plan the solar installation properly.",
      },
      {
        title: "Unloading",
        description:
          "Our team ensures safe transport using large vehicles, along with careful loading and unloading of solar panels, inverters, and other materials to prevent any damage.",
      },
      {
        title: "Lifting",
        description:
          "We move the solar panels and other materials to the installation area safely using the right equipment.",
      },
      {
        title: "AC Earth",
        description:
          "We install a proper AC earthing system to protect the inverter and electrical components from shocks or damage due to power faults.",
      },
      {
        title: "DC Earth",
        description:
          "A DC earthing system is installed to protect solar panels and wiring from electrical issues, ensuring smooth energy flow.",
      },
      {
        title: "Lightning Arrester",
        description:
          "We install lightning arresters to protect the solar system from lightning strikes, preventing damage to the panels and electrical equipment.",
      },
      {
        title: "Customized Structure Work",
        description:
          "Based on the site's needs, we build strong mounting structures using 2X2-inch 2mm thickness galvanized pipes. These structures keep the panels secure and last for years.",
      },
      {
        title: "Panel Installation",
        description:
          "Our experts fix the solar panels at the best angle and position to capture maximum sunlight and generate the most power.",
      },
      {
        title: "Cable Laying",
        description:
          "We neatly arrange and connect all cables, ensuring safe and efficient power transmission from the panels to the inverter and main grid.",
      },
      {
        title: "Net Meter Payment",
        description:
          "Our team assists with the net meter payment process and coordinates with the electricity board (EB) or DISCOM. The DISCOM or EB provides the net meter, which is essential for measuring the solar power exported to the grid.",
      },
      {
        title: "Commissioning",
        description:
          "We check and test the system after installation, making sure everything works correctly before turning it on.",
      },
      {
        title: "System Configuration (After Net Meter Connection)",
        description:
          "Once the net meter is installed, we set up the system, configure settings, and enable performance monitoring for smooth operation.",
      },
      {
        title: "Five Years Free Service",
        description:
          "We provide free service for five years, including regular maintenance and system checks to ensure long-term performance. 3 Months Once: [1. Solar Panel Cleaning, 2. Solar Plant Inspection, 3. Inverter Inspection, 4. Electrical Connection Inspection, 5. Earthing & Lightning Protection Check, 6. Fault Complaint Support]",
      },
    ];
    base.paymentMilestones = [
      {
        label: "Advance Payment",
        percentage: 80,
        description: "To be paid before the commencement of the project.",
      },
      {
        label: "After the Installation of Work",
        percentage: 15,
        description:
          "Can be released after the full completion of the installation work, excluding the net metering process.",
      },
      {
        label: "After Commissioning of the Net Meter",
        percentage: 5,
        description:
          "Kindly release the amount after the completion of the net meter commissioning process.",
      },
    ];
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
      unit: type === "quotation" || isGst,
      discount: type === "quotation",
      tax: type === "quotation" || isGst,
      customFields: [],
    },
    customFields: Array.isArray(customFields) ? customFields : [],
    itemCustomFields: Array.isArray(itemCustomFields) ? itemCustomFields : [],
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
];
