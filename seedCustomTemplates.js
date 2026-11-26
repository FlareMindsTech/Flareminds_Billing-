import "dotenv/config";
import mongoose from "mongoose";

import DocumentTemplate from "./models/DocumentTemplate.js";
import {
  buildDefaultTemplateConfig,
  defaultContent,
  defaultLabels,
  defaultLayout,
  defaultSections,
} from "./services/templatePresets.js";

// The backend .env currently points at an Atlas cluster whose URI has no database
// path, so the app itself resolves to the "test" database. This seed is explicitly
// targeting flareminds_billing as requested; update the app's MONGO_URI when you
// want these platform templates to show up in the app.
const DB_NAME = "flareminds_billing";

if (!process.env.MONGO_URI) {
  console.error("MONGO_URI is not set. Add it to the backend .env and rerun.");
  process.exit(1);
}

const docField = (key, label, defaultValue = null, type = "text", options = []) => ({
  key,
  label,
  type,
  options,
  required: false,
  defaultValue,
  showOnPdf: true,
});

const itemField = (key, label, type = "text") => ({
  key,
  label,
  type,
  required: false,
  showOnPdf: true,
});

function sectionsWithBank(docType) {
  const sections = defaultSections(docType);
  if (sections.some((section) => section.key === "bank")) return sections;
  const at = Math.min(4, sections.length);
  sections.splice(at, 0, { key: "bank", label: "Bank details", enabled: true, order: at });
  return sections.map((section, index) => ({ ...section, order: index }));
}

function makeTemplate({ name, code, description, docType, preset, overrides }) {
  const base = buildDefaultTemplateConfig(docType, { name, preset });
  return {
    ...base,
    code,
    description,
    companyId: null,
    isSystem: true,
    isDefault: false,
    isActive: true,
    version: 1,
    ...overrides,
  };
}

const templates = [
  makeTemplate({
    name: "Solar EPC Turnkey Proposal",
    code: "SYS-SOLAR-EPC-TURNKEY-QUOTATION",
    description:
      "Turnkey grid-connected rooftop solar EPC proposal with system capacity specs, subsidy note, 80/15/5 payment milestones and a 13-step scope of work.",
    docType: "quotation",
    preset: "commercial-proposal",
    overrides: {
      layout: defaultLayout({
        preset: "commercial-proposal",
        accentColor: "#0b7a6b",
        footerText: "Turnkey Solar EPC - Design, Supply, Installation, Commissioning",
      }),
      sections: sectionsWithBank("quotation"),
      columns: {
        category: true,
        itemType: true,
        unit: true,
        discount: true,
        tax: true,
        customFields: ["spec"],
      },
      customFields: [
        docField(
          "systemCapacity",
          "System Capacity (kWp)",
          "100 kWp (configurable per site)"
        ),
        docField(
          "panelSpec",
          "Module Specification",
          "Mono PERC / TOPCon, 550 Wp class, 25-year performance warranty"
        ),
        docField(
          "subsidyNote",
          "Subsidy Note",
          "Subsidy is subject to the applicable central/state scheme and eligibility. "
            + "We will assist with documentation and application; disbursement is at the authority's discretion."
        ),
        docField("salesRep", "Prepared By", "Solar Projects Team"),
        docField("projectScope", "Project Scope", "Turnkey rooftop solar EPC"),
        docField("estimatedTimeline", "Estimated Delivery", "8-12 weeks from order and site handover"),
      ],
      itemCustomFields: [
        itemField("spec", "Panel / Inverter Spec"),
        itemField("deliverableScope", "Work Item Detail"),
      ],
      labels: {
        ...defaultLabels("quotation", "commercial-proposal"),
        quotationTitle: "SOLAR EPC TURNKEY PROPOSAL",
        clientSectionTitle: "BILL TO",
        itemDescriptionLabel: "Solar Component / Work Item",
        itemCategoryLabel: "Category",
        itemUnitLabel: "Unit",
        itemQuantityLabel: "Qty",
        itemRateLabel: "Rate",
        itemAmountLabel: "Amount",
        notesLabel: "Notes / Subsidy",
      },
      content: {
        ...defaultContent("quotation", "commercial-proposal"),
        subject: "Supply, installation and commissioning of a grid-connected rooftop solar power plant",
        servicesBanner:
          "Turnkey Solar EPC - Design, Supply, Installation, Commissioning & Net-Metering Support",
        showServicesBanner: true,
        purposeText:
          "We are pleased to submit this turnkey EPC proposal for a grid-connected rooftop "
            + "solar power system. The design, supply, installation and commissioning scope is "
            + "tailored to your sanctioned load, roof area and applicable subsidy scheme.",
        closingText:
          "We hope the above offer meets your requirement and look forward to your valued order.",
        noticeText:
          "Prices are indicative and subject to site survey, final roof/structural assessment "
            + "and DISCOM net-metering approval. Subsidy is applied as per the scheme in force.",
        validityText: "30 Days",
        signatoryTitle: "Authorised Signatory - Solar EPC Division",
        scopeOfWork: [
          "Site survey, shadow analysis, roof condition and structural load assessment.",
          "Detailed engineering, single-line diagram and electrical design for a 100 kWp (configurable) grid-connected system.",
          "Module layout, string configuration and DC/AC cable sizing as per site conditions.",
          "Supply of Mono PERC / TOPCon modules (550 Wp class) with 25-year linear performance warranty.",
          "Supply of grid-tied string inverters with 5-year standard warranty, extendable on request.",
          "Supply of hot-dip galvanised mounting structures rated for site wind and snow load.",
          "Supply of DC/AC cables, connectors, array junction boxes, earthing and lightning protection.",
          "Installation of mounting structures with waterproofing to avoid any roof leakage.",
          "Module mounting, string cabling and inverter / ACDB installation as per approved design.",
          "AC distribution board, protection devices and net-meter interconnection.",
          "Commissioning, insulation and performance testing with a handover test report.",
          "Net-metering application preparation and coordination with the DISCOM / utility.",
          "Operation & maintenance manual, as-built drawings and 12 months of free O&M support.",
        ],
        processSteps: [
          { title: "Site assessment", description: "Roof measurement, shadow study and structural review." },
          { title: "Design & approval", description: "SLD, layout and BOQ finalised with client sign-off." },
          { title: "Procurement", description: "Modules, inverters, structures and BoS material arranged." },
          { title: "Installation", description: "Structures, modules, cabling and ACDB installed safely." },
          { title: "Commissioning", description: "Testing, grid synchronisation and net-meter coordination." },
          { title: "Handover", description: "As-built drawings, O&M manual and training provided." },
        ],
        paymentMilestones: [
          {
            label: "Advance on order confirmation",
            percentage: 80,
            description: "80% of the project value on acceptance of this proposal and release of the purchase order.",
          },
          {
            label: "Before commissioning",
            percentage: 15,
            description: "15% on completion of installation and prior to grid synchronisation / commissioning.",
          },
          {
            label: "After commissioning & handover",
            percentage: 5,
            description: "5% within 15 days of commissioning, net-metering submission and document handover.",
          },
        ],
        showGstBreakup: false,
        showBankDetails: true,
        showPaymentSummary: true,
        showSignature: true,
        showAmountInWords: true,
      },
    },
  }),

  makeTemplate({
    name: "IT Software & SaaS Quotation",
    code: "SYS-IT-SOFTWARE-SAAS-QUOTATION",
    description:
      "Web and mobile software development quotation with project phases, deliverables table, timeline and AMC/support terms.",
    docType: "quotation",
    preset: "it-services",
    overrides: {
      layout: defaultLayout({
        preset: "it-services",
        accentColor: "#2563eb",
        footerText: "Custom Software, Web & Mobile App Development",
      }),
      sections: sectionsWithBank("quotation"),
      columns: {
        category: true,
        itemType: false,
        unit: true,
        discount: true,
        tax: true,
        customFields: ["sacCode", "deliverableScope", "phase"],
      },
      customFields: [
        docField("projectName", "Project Name", "Custom Web & Mobile Application"),
        docField("poNumber", "PO Number"),
        docField("paymentTerms", "Payment Terms", "Net 30", "select", [
          "Due on Receipt",
          "Net 15",
          "Net 30",
          "Net 45",
          "Net 60",
        ]),
        docField(
          "projectPhases",
          "Project Phases",
          "Discovery & Planning | UI/UX Design | Development | QA & Testing | Deployment & Handover"
        ),
        docField(
          "projectTimeline",
          "Estimated Timeline",
          "12-16 weeks from kickoff and approval of wireframes"
        ),
        docField(
          "deliverables",
          "Deliverables",
          "Responsive web app, admin CMS, iOS/Android build, API integrations, source code and deployment guide"
        ),
        docField(
          "amcSupportTerms",
          "AMC / Support Terms",
          "12 months free AMC after go-live; thereafter 18% of project value per year. Response SLA: 1 business day."
        ),
      ],
      itemCustomFields: [
        itemField("sacCode", "SAC Code"),
        itemField("deliverableScope", "Deliverable / Module"),
        itemField("phase", "Project Phase"),
      ],
      labels: {
        ...defaultLabels("quotation", "it-services"),
        quotationTitle: "SOFTWARE DEVELOPMENT QUOTATION",
        clientSectionTitle: "CLIENT / BILL TO",
        itemDescriptionLabel: "Deliverable / Module",
        itemCategoryLabel: "Workstream",
        itemUnitLabel: "Unit",
        itemQuantityLabel: "Qty",
        itemRateLabel: "Rate",
        itemDiscountLabel: "Disc",
        itemTaxLabel: "GST",
        itemAmountLabel: "Amount",
        notesLabel: "Project Notes",
        termsLabel: "AMC & Support Terms",
      },
      content: {
        ...defaultContent("quotation", "it-services"),
        subject: "Design, development and deployment of a custom web / mobile software product",
        purposeText:
          "The deliverables table below lists each module, its scope and the applicable project phase. "
            + "Timelines and AMC/support terms are summarised in the project fields.",
        closingText: "We look forward to partnering with you on this delivery.",
        noticeText:
          "Scope changes after sign-off are quoted separately. Third-party licences, cloud and API costs are billed at actuals.",
        validityText: "30 Days",
        signatoryTitle: "Authorised Signatory - Technology Delivery",
        scopeOfWork: [
          "Discovery workshop, requirement documentation and technical architecture.",
          "UI/UX wireframes, design system and approved high-fidelity screens.",
          "Front-end and back-end development with version-controlled source code.",
          "API / third-party integrations and database design.",
          "QA: functional, responsiveness, security and performance testing.",
          "Deployment, go-live support, documentation and knowledge transfer.",
        ],
        processSteps: [
          { title: "Discovery & planning", description: "Requirements, scope sign-off and delivery plan." },
          { title: "UI/UX design", description: "Wireframes and approved visual designs." },
          { title: "Development", description: "Sprint-wise build of web, admin and mobile modules." },
          { title: "QA & testing", description: "Functional, security and performance validation." },
          { title: "Deployment & handover", description: "Production release, training and AMC kickoff." },
        ],
        paymentMilestones: [
          { label: "On project kickoff", percentage: 30, description: "30% on signing and project kickoff." },
          { label: "On design & alpha release", percentage: 40, description: "40% on design approval and alpha build delivery." },
          { label: "On go-live & handover", percentage: 30, description: "30% on production go-live and handover." },
        ],
        showGstBreakup: true,
        showBankDetails: true,
        showPaymentSummary: true,
        showSignature: true,
        showAmountInWords: true,
        showServicesBanner: false,
      },
    },
  }),

  makeTemplate({
    name: "Medical Coding & RCM Invoice",
    code: "SYS-MEDICAL-RCM-INVOICE",
    description:
      "Healthcare billing, medical coding and revenue cycle management invoice with HSN/SAC codes, CGST/SGST and IGST breakup, and company bank details.",
    docType: "invoice",
    preset: "gst-invoice",
    overrides: {
      layout: defaultLayout({
        preset: "gst-invoice",
        accentColor: "#00875a",
        footerText: "Medical Coding, Billing & Revenue Cycle Management Services",
      }),
      sections: defaultSections("invoice"),
      columns: {
        category: true,
        itemType: false,
        unit: true,
        discount: false,
        tax: true,
        customFields: ["hsnCode", "servicePeriod"],
      },
      customFields: [
        docField("defaultHsnSac", "Default HSN / SAC", "998313"),
        docField("taxType", "GST Tax Type", "cgst_sgst", "select", ["cgst_sgst", "igst"]),
        docField("poNumber", "Purchase Order (PO) #"),
        docField("paymentTerms", "Payment Terms", "Net 30", "select", [
          "Due on Receipt",
          "Net 15",
          "Net 30",
          "Net 45",
          "Net 60",
        ]),
        docField("referenceNo", "Reference / Dispatch No."),
      ],
      itemCustomFields: [
        itemField("hsnCode", "HSN / SAC Code"),
        itemField("servicePeriod", "Service Period"),
      ],
      labels: {
        ...defaultLabels("invoice", "gst-invoice"),
        invoiceTitle: "MEDICAL CODING & RCM INVOICE",
        clientSectionTitle: "BILL TO",
        itemDescriptionLabel: "Coding / RCM Service",
        itemCategoryLabel: "Service Category",
        itemUnitLabel: "Unit",
        itemQuantityLabel: "Qty",
        itemRateLabel: "Rate",
        itemTaxLabel: "GST",
        itemAmountLabel: "Amount",
        taxTotalLabel: "GST Total",
        grandTotalLabel: "Grand Total",
        notesLabel: "Billing Notes",
      },
      content: {
        ...defaultContent("invoice", "gst-invoice"),
        subject: "Medical coding, healthcare billing and revenue cycle management services",
        closingText: "Thank you for your business.",
        noticeText:
          "CGST and SGST apply to intra-state supply; IGST applies to inter-state supply. "
            + "HSN/SAC codes are shown per service line. Payment details are listed in the bank section.",
        validityText: "",
        signatoryTitle: "Authorised Signatory - Finance",
        scopeOfWork: [
          "CPT/HCPCS and ICD-10-CM coding review and assignment.",
          "Claims scrubbing, submission and payer follow-up.",
          "Denial management, appeals and resubmission workflows.",
          "AR ageing analysis and collections coordination.",
          "Compliance checks and coding audits under HIPAA guidelines.",
          "Monthly MIS and revenue cycle performance reporting.",
        ],
        processSteps: [],
        paymentMilestones: [],
        showGstBreakup: true,
        showAmountInWords: true,
        showBankDetails: true,
        showPaymentSummary: true,
        showSignature: true,
        showServicesBanner: false,
      },
    },
  }),
];

async function upsertTemplate(template) {
  const filter = { companyId: null, isSystem: true, code: template.code };
  const result = await DocumentTemplate.updateOne(filter, { $set: template }, {
    upsert: true,
    runValidators: true,
    setDefaultsOnInsert: true,
  });
  if (result.upsertedCount) return "created";
  if (result.modifiedCount) return "updated";
  return "unchanged";
}

async function main() {
  const connection = await mongoose.connect(process.env.MONGO_URI, { dbName: DB_NAME });
  console.log(`Connected to ${connection.connection.host} / ${connection.connection.name}`);

  const before = await DocumentTemplate.countDocuments({});
  console.log(`documenttemplates before seed: ${before}`);

  for (const template of templates) {
    const status = await upsertTemplate(template);
    console.log(`${status.padEnd(8)} ${template.name} (${template.code})`);
  }

  const after = await DocumentTemplate.countDocuments({});
  console.log(`documenttemplates after seed:  ${after}`);

  const codes = templates.map((template) => template.code);
  const saved = await DocumentTemplate.find({
    companyId: null,
    isSystem: true,
    code: { $in: codes },
  })
    .sort({ name: 1 })
    .lean();

  console.log("\nVerification:");
  for (const doc of saved) {
    const content = doc.content || {};
    console.log(
      `- ${doc.name} | ${doc.docType} | preset=${doc.layout?.preset}`
        + ` | scope=${content.scopeOfWork?.length || 0}`
        + ` | steps=${content.processSteps?.length || 0}`
        + ` | milestones=${content.paymentMilestones?.length || 0}`
        + ` | gst=${content.showGstBreakup !== false}`
        + ` | bank=${content.showBankDetails !== false}`
    );
  }
  if (saved.length !== codes.length) {
    throw new Error(`Expected ${codes.length} templates, found ${saved.length}`);
  }
  console.log(`All ${saved.length} custom platform templates verified.`);
}

main()
  .catch(async (error) => {
    console.error("Seed failed:", error.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
