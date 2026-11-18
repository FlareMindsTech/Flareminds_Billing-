import "dotenv/config";

import mongoose from "mongoose";

import { connectDB } from "../config/db.js";
import Admin from "../models/Admin.js";
import Client from "../models/Client.js";
import Company from "../models/Company.js";
import DocumentTemplate from "../models/DocumentTemplate.js";
import Invoice from "../models/Invoice.js";
import Quotation from "../models/Quotation.js";
import { ensureDefaultTemplates, resolveTemplate, templateSnapshot } from "../services/templateService.js";
import { buildDefaultTemplateConfig, defaultLabels } from "../services/templatePresets.js";
import { computeQuotationTotals } from "../services/quotationCalculator.js";
import { nextQuotationNumber } from "../services/quotationNumber.js";
import { computeTotals, nextInvoiceNumber } from "../controllers/invoiceController.js";

const CREDENTIALS = {
  superadmin: { email: "superadmin@flareminds.com", password: "Super@123" },
  flare: { email: "admin@flareminds.com", password: "Flare@123" },
  brightline: { email: "admin@brightline.com", password: "Bright@123" },
};

const addDays = (date, days) => {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
};

const clientSnapshotOf = (client) => ({
  name: client.name || "",
  company: client.company || "",
  address: client.address || "",
  email: client.email || "",
  whatsapp: client.whatsapp || "",
  phone: client.phone || "",
  gstn: client.gstn || "",
});

async function upsertSuperadmin() {
  const passwordHash = await Admin.hashPassword(CREDENTIALS.superadmin.password);
  const admin = await Admin.findOneAndUpdate(
    { email: CREDENTIALS.superadmin.email },
    {
      email: CREDENTIALS.superadmin.email,
      passwordHash,
      name: "Platform Superadmin",
      role: "superadmin",
      companyId: null,
      isActive: true,
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return admin;
}

async function upsertCompanyAdmin(company, { email, password, name }) {
  const passwordHash = await Admin.hashPassword(password);
  return Admin.findOneAndUpdate(
    { email },
    {
      email,
      passwordHash,
      name,
      role: "company_admin",
      companyId: company._id,
      isActive: true,
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

const flareCompany = {
  name: "FlareMinds Technology and Services",
  code: "FLARE",
  tagline: "Digital marketing, web and product engineering",
  address: "2nd Floor, Tidel Park, Taramani, Chennai - 600113",
  phone: "+91 44 4855 1200",
  email: "hello@flareminds.com",
  website: "https://flareminds.com",
  gstn: "33AABCF1234G1Z8",
  invoicePrefix: "FM",
  quotationPrefix: "FM-QTN",
  currency: "INR",
  defaultTaxPercent: 18,
  defaultInvoiceNotes: "Thank you for your business. Please quote the invoice number on all payments.",
  defaultQuotationNotes: "This proposal is valid for 30 days from the issue date.",
  defaultTermsAndConditions: "50% advance with purchase order, balance on delivery.",
  defaultPaymentTerms: "Net 15 days from invoice date.",
  defaultDeliveryTimeline: "6-8 weeks from project kick-off.",
  defaultWarrantyTerms: "90-day defect warranty on delivered software.",
  defaultExclusions: "Third-party licences and ad spend are billed separately.",
  bank: {
    accountName: "FlareMinds Technology and Services",
    accountNumber: "50200045678901",
    ifsc: "HDFC0001234",
    branch: "Taramani, Chennai",
    upi: "flareminds@hdfcbank",
  },
  customFields: [
    { key: "poNumber", label: "Purchase Order No.", type: "text", required: false, appliesTo: "both" },
    { key: "projectCode", label: "Project Code", type: "text", required: false, appliesTo: "both" },
  ],
  itemCustomFields: [
    { key: "hsnCode", label: "HSN / SAC Code", type: "text", required: false },
  ],
  customLabels: defaultLabels("quotation"),
  status: "active",
  isActive: true,
};

const brightlineCompany = {
  name: "Brightline Interiors",
  code: "BRIGHT",
  tagline: "Interior design and turnkey home solutions",
  address: "18/3 Lavelle Road, Bengaluru - 560001",
  phone: "+91 80 4123 7788",
  email: "studio@brightlineinteriors.in",
  website: "https://brightlineinteriors.in",
  gstn: "29AACCB9876K1Z4",
  invoicePrefix: "BRIGHT",
  quotationPrefix: "BRIGHT-QTN",
  currency: "INR",
  defaultTaxPercent: 18,
  defaultInvoiceNotes: "Thank you for choosing Brightline Interiors.",
  defaultQuotationNotes: "Design fees are inclusive of two revision rounds.",
  defaultTermsAndConditions: "40% advance, 40% on material dispatch, 20% on handover.",
  defaultPaymentTerms: "Net 10 days from invoice date.",
  defaultDeliveryTimeline: "45-60 days from design sign-off.",
  defaultWarrantyTerms: "One-year warranty on modular fittings.",
  defaultExclusions: "Civil work, electrical rewiring and loose furniture are excluded.",
  bank: {
    accountName: "Brightline Interiors",
    accountNumber: "918020045678123",
    ifsc: "ICIC0000456",
    branch: "Lavelle Road, Bengaluru",
    upi: "brightline@icici",
  },
  customFields: [
    { key: "projectCode", label: "Project Code", type: "text", required: false, appliesTo: "both" },
    { key: "siteAddress", label: "Site Address", type: "text", required: false, appliesTo: "both" },
  ],
  itemCustomFields: [
    { key: "serialNumber", label: "Serial / Batch No.", type: "text", required: false },
  ],
  customLabels: {
    ...defaultLabels("quotation"),
    quotationTitle: "INTERIOR PROPOSAL",
    clientSectionTitle: "PREPARED FOR",
    notesLabel: "Design Notes",
  },
  status: "active",
  isActive: true,
};

async function upsertCompanies(superadmin) {
  const flare = await Company.findOneAndUpdate(
    { code: flareCompany.code },
    { $set: { ...flareCompany, createdBy: superadmin._id } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  const brightline = await Company.findOneAndUpdate(
    { code: brightlineCompany.code },
    { $set: { ...brightlineCompany, createdBy: superadmin._id } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  // Make FlareMinds the default tenant without touching any other data.
  await Company.updateMany(
    { _id: { $ne: flare._id } },
    { $set: { isDefault: false } }
  );
  flare.isDefault = true;
  await flare.save();

  brightline.isDefault = false;
  await brightline.save();

  return { flare, brightline };
}

async function ensureTemplates(company) {
  const templates = await ensureDefaultTemplates(company._id);

  const customDefinitions = [
    {
      name: "Modern Invoice",
      docType: "invoice",
      preset: "modern",
      accentColor: "#0ea5e9",
      code: "MODERN-INVOICE",
      customFields: [
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
          label: "Dispatch / REF",
          type: "text",
          required: false,
          placeholder: "e.g. DISP-9921",
          showOnPdf: true,
          order: 2,
        },
      ],
      itemCustomFields: [
        {
          key: "hsnCode",
          label: "HSN / SAC",
          type: "text",
          required: false,
          placeholder: "e.g. 998313",
          showOnPdf: true,
          order: 0,
        },
      ],
    },
    {
      name: "Minimal Quotation",
      docType: "quotation",
      preset: "minimal",
      accentColor: "#16a34a",
      code: "MINIMAL-QUOTATION",
      customFields: [
        {
          key: "projectScope",
          label: "Project Scope",
          type: "text",
          required: false,
          placeholder: "e.g. Phase 1 Implementation",
          showOnPdf: true,
          order: 0,
        },
        {
          key: "estimatedTimeline",
          label: "Estimated Delivery",
          type: "text",
          required: false,
          placeholder: "e.g. 2-3 Weeks upon approval",
          showOnPdf: true,
          order: 1,
        },
      ],
      itemCustomFields: [
        {
          key: "deliverableScope",
          label: "Scope / Spec",
          type: "text",
          required: false,
          placeholder: "e.g. Deliverable breakdown",
          showOnPdf: true,
          order: 0,
        },
      ],
    },
  ];

  for (const definition of customDefinitions) {
    const existing = await DocumentTemplate.findOne({
      companyId: company._id,
      name: definition.name,
    });
    if (existing) continue;

    const config = buildDefaultTemplateConfig(definition.docType, {
      name: definition.name,
      preset: definition.preset,
      customFields: definition.customFields,
      itemCustomFields: definition.itemCustomFields,
    });

    await DocumentTemplate.create({
      ...config,
      companyId: company._id,
      code: definition.code,
      description: `${definition.preset} preset with a custom accent colour.`,
      isDefault: false,
      layout: { ...config.layout, accentColor: definition.accentColor },
    });
  }

  return templates;
}

async function findTemplate(company, docType, name) {
  const template =
    (await DocumentTemplate.findOne({ companyId: company._id, docType, name, isActive: true })) ||
    (await resolveTemplate(company._id, docType));
  if (!template) return { templateId: null, templateSnapshot: null };
  return {
    templateId: template._id,
    templateSnapshot: templateSnapshot(template, company),
  };
}

const flareClients = [
  {
    name: "Dr. Sekar V",
    company: "AVK Hospital",
    address: "Thondi, Ramanathapuram - 623403",
    email: "sekar@avkhospital.in",
    whatsapp: "919500950813",
    phone: "+91 95009 50813",
    gstn: "33ABCDE1234F1Z5",
    notes: "Prefers WhatsApp for invoice delivery.",
  },
  {
    name: "Priya Raman",
    company: "Bloom Interiors",
    address: "44 Race Course Road, Coimbatore - 641018",
    email: "priya@bloominteriors.in",
    whatsapp: "919876543210",
    phone: "+91 98765 43210",
    gstn: "33XYZAB6789G1Z2",
    notes: "Retainer client - monthly social media.",
  },
  {
    name: "Arjun Kumar",
    company: "Nexa Tech Solutions",
    address: "12 OMR, Chennai - 600096",
    email: "arjun@nexatech.io",
    whatsapp: "919812345678",
    phone: "+91 98123 45678",
    gstn: "33LMNOP4321H1Z9",
    notes: "Invoices require PO number in description.",
  },
];

const brightlineClients = [
  {
    name: "Meera Nair",
    company: "Nair Residences",
    address: "Marine Drive, Kochi - 682031",
    email: "meera@nairresidences.in",
    whatsapp: "919845012345",
    phone: "+91 98450 12345",
    gstn: "32MNOPQ2468R1Z7",
    notes: "3BHK full-home project.",
  },
  {
    name: "Rahul Verma",
    company: "Verma Retail Group",
    address: "Indiranagar, Bengaluru - 560038",
    email: "rahul@vermaretail.com",
    whatsapp: "919900112233",
    phone: "+91 99001 12233",
    gstn: "29RSTUV1357W1Z3",
    notes: "Prefers email communication.",
  },
  {
    name: "Kavya Iyer",
    company: "Studio K Design",
    address: "Jubilee Hills, Hyderabad - 500033",
    email: "kavya@studiok.design",
    whatsapp: "919701445566",
    phone: "+91 97014 45566",
    gstn: "36WXYZA8642B1Z1",
    notes: "Repeat client for styled shoots.",
  },
];

async function upsertClients(company, records) {
  const docs = [];
  for (const record of records) {
    const doc = await Client.findOneAndUpdate(
      { companyId: company._id, email: record.email },
      { $set: { ...record, companyId: company._id } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    docs.push(doc);
  }
  return docs;
}

const quotationSeeds = [
  {
    clientIndex: 0,
    status: "sent",
    daysAgo: 6,
    validDays: 30,
    shippingCharges: 0,
    customFields: { poNumber: "PO-AVK-1042", projectCode: "FM-WEB-01" },
    items: [
      { description: "Corporate website design (12 pages)", category: "Website", itemType: "Design", unit: "project", quantity: 1, unitPrice: 85000, taxPercent: 18, customFields: { hsnCode: "998314" } },
      { description: "Frontend and backend development", category: "Development", itemType: "Service", unit: "project", quantity: 1, unitPrice: 145000, taxPercent: 18, customFields: { hsnCode: "998314" } },
      { description: "On-page SEO setup", category: "Digital Marketing", itemType: "Service", unit: "month", quantity: 3, unitPrice: 12000, discountType: "percent", discountValue: 10, taxPercent: 18 },
    ],
    notes: "Proposal covers design, development and launch support.",
    termsAndConditions: "50% advance, balance on go-live.",
    paymentTerms: "Net 15 days.",
    deliveryTimeline: "8 weeks from content sign-off.",
  },
  {
    clientIndex: 2,
    status: "accepted",
    daysAgo: 21,
    validDays: 30,
    shippingCharges: 0,
    customFields: { poNumber: "PO-NEXA-2201", projectCode: "FM-APP-07" },
    items: [
      { description: "Mobile app MVP (iOS + Android)", category: "Application", itemType: "Service", unit: "project", quantity: 1, unitPrice: 320000, discountType: "amount", discountValue: 20000, taxPercent: 18 },
      { description: "UI/UX wireframes and clickable prototype", category: "Application", itemType: "Design", unit: "project", quantity: 1, unitPrice: 45000, taxPercent: 18 },
    ],
    notes: "Accepted after the discovery workshop. Development scheduled next sprint.",
    termsAndConditions: "Milestone-based billing.",
    paymentTerms: "30% kick-off, 40% beta, 30% launch.",
    deliveryTimeline: "10 weeks.",
  },
  {
    clientIndex: 1,
    status: "draft",
    daysAgo: 1,
    validDays: 30,
    shippingCharges: 1500,
    customFields: { poNumber: "", projectCode: "FM-RET-02" },
    items: [
      { description: "Monthly digital marketing retainer", category: "Digital Marketing", itemType: "Retainer", unit: "month", quantity: 6, unitPrice: 30000, discountType: "percent", discountValue: 5, taxPercent: 18 },
      { description: "Campaign landing page design", category: "Website", itemType: "Design", unit: "page", quantity: 4, unitPrice: 7500, taxPercent: 18 },
    ],
    notes: "Draft retainer proposal for the next two quarters.",
    termsAndConditions: "Monthly invoicing in advance.",
    paymentTerms: "Net 7 days.",
    deliveryTimeline: "Campaign live within 2 weeks.",
  },
];

const brightlineQuotationSeeds = [
  {
    clientIndex: 0,
    status: "sent",
    daysAgo: 4,
    validDays: 21,
    shippingCharges: 0,
    customFields: { projectCode: "BL-NR-3BHK", siteAddress: "Marine Drive, Kochi" },
    items: [
      { description: "3BHK full-home interior design fee", category: "Design", itemType: "Design", unit: "project", quantity: 1, unitPrice: 120000, taxPercent: 18 },
      { description: "Modular kitchen with premium finishes", category: "Modular", itemType: "Turnkey", unit: "set", quantity: 1, unitPrice: 185000, taxPercent: 18, customFields: { serialNumber: "MK-2026-118" } },
      { description: "Built-in wardrobes (3 bedrooms)", category: "Wardrobe", itemType: "Turnkey", unit: "unit", quantity: 3, unitPrice: 32000, discountType: "percent", discountValue: 5, taxPercent: 18 },
    ],
    notes: "Design direction: warm minimal with brass accents.",
    termsAndConditions: "Design fee adjustable against final turnkey order.",
    paymentTerms: "40% advance, 40% dispatch, 20% handover.",
    deliveryTimeline: "55 days from sign-off.",
    templateName: "Minimal Quotation",
  },
  {
    clientIndex: 1,
    status: "rejected",
    daysAgo: 16,
    validDays: 21,
    shippingCharges: 0,
    customFields: { projectCode: "BL-VRG-REC", siteAddress: "Indiranagar, Bengaluru" },
    items: [
      { description: "Retail store reception redesign", category: "Design", itemType: "Design", unit: "project", quantity: 1, unitPrice: 95000, taxPercent: 18 },
      { description: "Display fixtures and lighting", category: "Turnkey", itemType: "Execution", unit: "set", quantity: 1, unitPrice: 140000, taxPercent: 18 },
    ],
    notes: "Revised after the client postponed the store launch.",
    decisionNote: "Client postponed the project to next quarter.",
    termsAndConditions: "40% advance.",
    paymentTerms: "Net 10 days.",
    deliveryTimeline: "30 days.",
  },
  {
    clientIndex: 2,
    status: "draft",
    daysAgo: 0,
    validDays: 21,
    shippingCharges: 0,
    customFields: { projectCode: "BL-SK-VILLA", siteAddress: "Jubilee Hills, Hyderabad" },
    items: [
      { description: "Luxury villa interior consultation", category: "Design", itemType: "Consulting", unit: "day", quantity: 8, unitPrice: 12000, taxPercent: 18 },
      { description: "Material and finish palette curation", category: "Design", itemType: "Design", unit: "project", quantity: 1, unitPrice: 35000, taxPercent: 18 },
    ],
    notes: "Initial consultation scope for the 6,000 sq ft villa.",
    termsAndConditions: "Consultation fee payable in advance.",
    paymentTerms: "Net 5 days.",
    deliveryTimeline: "Two weeks.",
  },
];

async function seedQuotations(company, clients, admin, seeds) {
  if (await Quotation.countDocuments({ companyId: company._id })) {
    console.log(`Quotations already exist for ${company.code}; skipping.`);
    return;
  }

  let created = 0;
  for (const seed of seeds) {
    const client = clients[seed.clientIndex];
    const issueDate = addDays(new Date(), -seed.daysAgo);
    const validUntil = addDays(issueDate, seed.validDays);
    const totals = computeQuotationTotals(seed.items, seed.shippingCharges);
    const templateInfo = await findTemplate(
      company,
      "quotation",
      seed.templateName || null
    );
    const quotationNumber = await nextQuotationNumber(issueDate, company);

    const sentLog =
      seed.status === "draft"
        ? []
        : [
            {
              channel: "email",
              to: client.email,
              sentAt: issueDate,
              success: true,
            },
          ];

    const quotation = await Quotation.create({
      quotationNumber,
      companyId: company._id,
      client: client._id,
      clientSnapshot: clientSnapshotOf(client),
      issueDate,
      validUntil,
      status: seed.status,
      lineItems: totals.items,
      subTotal: totals.subTotal,
      discountTotal: totals.discountTotal,
      taxTotal: totals.taxTotal,
      shippingCharges: totals.shippingCharges,
      grandTotal: totals.grandTotal,
      currency: company.currency,
      notes: seed.notes || "",
      termsAndConditions: seed.termsAndConditions || "",
      paymentTerms: seed.paymentTerms || "",
      deliveryTimeline: seed.deliveryTimeline || "",
      customFields: seed.customFields || {},
      templateId: templateInfo.templateId,
      templateSnapshot: templateInfo.templateSnapshot,
      sentLog,
      createdBy: admin._id,
      ...(seed.status === "accepted" ? { acceptedAt: addDays(issueDate, 2) } : {}),
      ...(seed.status === "rejected"
        ? { rejectedAt: addDays(issueDate, 3), decisionNote: seed.decisionNote || "" }
        : {}),
    });

    await Quotation.updateOne(
      { _id: quotation._id },
      { $set: { createdAt: issueDate, updatedAt: issueDate } },
      { timestamps: false }
    );

    created += 1;
    console.log(`  Quotation ${quotationNumber} (${seed.status}) - ${client.name}`);
  }
  console.log(`Quotations ready for ${company.code}: ${created}`);
}

const flareInvoiceSeeds = [
  {
    clientIndex: 0,
    status: "paid",
    daysAgo: 38,
    dueInDays: 15,
    taxPercent: 18,
    customFields: { poNumber: "PO-AVK-0987", projectCode: "FM-WEB-01" },
    items: [
      { description: "Website maintenance and hosting - quarterly", category: "development", quantity: 1, rate: 18000 },
      { description: "Security patches and uptime monitoring", category: "other", quantity: 3, rate: 2000 },
    ],
    notes: "Quarterly maintenance invoice. Paid via NEFT.",
  },
  {
    clientIndex: 1,
    status: "sent",
    daysAgo: 7,
    dueInDays: 15,
    taxPercent: 18,
    customFields: { poNumber: "PO-BLM-1140", projectCode: "FM-RET-02" },
    items: [
      { description: "Social media content and ad management", category: "digital-marketing", quantity: 1, rate: 30000 },
      { description: "Campaign landing page revisions", category: "development", quantity: 2, rate: 4500 },
    ],
    notes: "Monthly retainer for the current cycle.",
  },
  {
    clientIndex: 2,
    status: "overdue",
    daysAgo: 30,
    dueInDays: 10,
    taxPercent: 18,
    customFields: { poNumber: "PO-NEXA-2175", projectCode: "FM-SEO-03" },
    items: [
      { description: "Technical SEO audit and remediation plan", category: "digital-marketing", quantity: 1, rate: 45000 },
    ],
    notes: "Audit delivered. Payment follow-up in progress.",
    templateName: "Modern Invoice",
  },
  {
    clientIndex: 0,
    status: "draft",
    daysAgo: 0,
    dueInDays: 15,
    taxPercent: 18,
    customFields: { poNumber: "", projectCode: "FM-CRM-09" },
    items: [
      { description: "CRM setup and workflow automation", category: "development", quantity: 1, rate: 60000 },
      { description: "Team training session", category: "other", quantity: 2, rate: 7500 },
    ],
    notes: "Draft invoice pending project sign-off.",
  },
];

const brightlineInvoiceSeeds = [
  {
    clientIndex: 0,
    status: "paid",
    daysAgo: 50,
    dueInDays: 10,
    taxPercent: 18,
    customFields: { projectCode: "BL-NR-3BHK", siteAddress: "Marine Drive, Kochi" },
    items: [
      { description: "Living room design and execution - phase 1", category: "other", quantity: 1, rate: 140000 },
      { description: "Furniture sourcing and coordination", category: "other", quantity: 1, rate: 60000 },
    ],
    notes: "Phase 1 handover completed and payment received.",
  },
  {
    clientIndex: 1,
    status: "sent",
    daysAgo: 4,
    dueInDays: 10,
    taxPercent: 18,
    customFields: { projectCode: "BL-VRG-REC", siteAddress: "Indiranagar, Bengaluru" },
    items: [
      { description: "Modular kitchen - premium finish", category: "other", quantity: 1, rate: 210000 },
      { description: "Counter-top and backsplash installation", category: "other", quantity: 1, rate: 38000 },
    ],
    notes: "Dispatch scheduled after advance confirmation.",
    templateName: "Modern Invoice",
  },
  {
    clientIndex: 2,
    status: "overdue",
    daysAgo: 28,
    dueInDays: 10,
    taxPercent: 18,
    customFields: { projectCode: "BL-SK-VILLA", siteAddress: "Jubilee Hills, Hyderabad" },
    items: [
      { description: "Office reception redesign - execution", category: "other", quantity: 1, rate: 95000 },
      { description: "Decorative lighting package", category: "other", quantity: 1, rate: 42000 },
    ],
    notes: "Reminder sent. Awaiting payment before site handover.",
  },
];

async function seedInvoices(company, clients, seeds) {
  if (await Invoice.countDocuments({ companyId: company._id })) {
    console.log(`Invoices already exist for ${company.code}; skipping.`);
    return;
  }

  let created = 0;
  for (const seed of seeds) {
    const client = clients[seed.clientIndex];
    const date = addDays(new Date(), -seed.daysAgo);
    const dueDate = addDays(date, seed.dueInDays);
    const { items, subTotal, taxTotal, grandTotal } = computeTotals(
      seed.items,
      seed.taxPercent
    );
    const templateInfo = await findTemplate(company, "invoice", seed.templateName || null);
    const invoiceNumber = await nextInvoiceNumber(date, company);
    const sentLog =
      seed.status === "draft"
        ? []
        : [
            {
              channel: "email",
              to: client.email,
              sentAt: date,
              success: true,
            },
          ];

    const invoice = await Invoice.create({
      invoiceNumber,
      companyId: company._id,
      client: client._id,
      date,
      dueDate,
      lineItems: items,
      subTotal,
      taxPercent: seed.taxPercent,
      taxAmount: taxTotal,
      grandTotal,
      notes: seed.notes,
      customFields: seed.customFields || {},
      templateId: templateInfo.templateId,
      templateSnapshot: templateInfo.templateSnapshot,
      status: seed.status,
      sentLog,
    });

    await Invoice.updateOne(
      { _id: invoice._id },
      { $set: { createdAt: date, updatedAt: date } },
      { timestamps: false }
    );

    created += 1;
    console.log(`  Invoice ${invoiceNumber} (${seed.status}) - ${client.name}`);
  }
  console.log(`Invoices ready for ${company.code}: ${created}`);
}

async function main() {
  try {
    await connectDB();

    console.log("\nSeeding superadmin...");
    const superadmin = await upsertSuperadmin();
    console.log(`  Superadmin ready: ${superadmin.email}`);

    console.log("Seeding companies...");
    const { flare, brightline } = await upsertCompanies(superadmin);
    console.log(`  Company ready: ${flare.name} (${flare.code})`);
    console.log(`  Company ready: ${brightline.name} (${brightline.code})`);

    console.log("Seeding tenant admins...");
    const flareAdmin = await upsertCompanyAdmin(flare, {
      ...CREDENTIALS.flare,
      name: "FlareMinds Admin",
    });
    const brightlineAdmin = await upsertCompanyAdmin(brightline, {
      ...CREDENTIALS.brightline,
      name: "Brightline Admin",
    });
    console.log(`  Admin ready: ${flareAdmin.email}`);
    console.log(`  Admin ready: ${brightlineAdmin.email}`);

    console.log("Seeding document templates...");
    await ensureTemplates(flare);
    await ensureTemplates(brightline);
    console.log("  Default + custom templates ready for both companies");

    console.log("Seeding clients...");
    const flareClientsDocs = await upsertClients(flare, flareClients);
    const brightlineClientsDocs = await upsertClients(brightline, brightlineClients);
    console.log(`  Clients ready: ${flareClientsDocs.length + brightlineClientsDocs.length}`);

    console.log("Seeding quotations...");
    await seedQuotations(flare, flareClientsDocs, flareAdmin, quotationSeeds);
    await seedQuotations(
      brightline,
      brightlineClientsDocs,
      brightlineAdmin,
      brightlineQuotationSeeds
    );

    console.log("Seeding invoices...");
    await seedInvoices(flare, flareClientsDocs, flareInvoiceSeeds);
    await seedInvoices(brightline, brightlineClientsDocs, brightlineInvoiceSeeds);

    const [companies, admins, clients, quotations, invoices, templates] =
      await Promise.all([
        Company.countDocuments(),
        Admin.countDocuments(),
        Client.countDocuments(),
        Quotation.countDocuments(),
        Invoice.countDocuments(),
        DocumentTemplate.countDocuments(),
      ]);

    console.log("\nDatabase now contains:");
    console.log(`  Companies: ${companies}`);
    console.log(`  Admins: ${admins}`);
    console.log(`  Clients: ${clients}`);
    console.log(`  Quotations: ${quotations}`);
    console.log(`  Invoices: ${invoices}`);
    console.log(`  Templates: ${templates}`);

    console.log("\n================ LOGIN CREDENTIALS ================");
    console.log("Superadmin");
    console.log(`  Email:    ${CREDENTIALS.superadmin.email}`);
    console.log(`  Password: ${CREDENTIALS.superadmin.password}`);
    console.log("\nFlareMinds tenant admin");
    console.log(`  Email:    ${CREDENTIALS.flare.email}`);
    console.log(`  Password: ${CREDENTIALS.flare.password}`);
    console.log("\nBrightline Interiors tenant admin");
    console.log(`  Email:    ${CREDENTIALS.brightline.email}`);
    console.log(`  Password: ${CREDENTIALS.brightline.password}`);
    console.log("===================================================\n");
  } catch (err) {
    console.error("Demo seed failed:", err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
