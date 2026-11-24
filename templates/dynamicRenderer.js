import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { invoicePaymentState, invoiceStatusLabel } from "../utils/invoicePayments.js";
import { TAX_TYPE_CGST_SGST, TAX_TYPE_IGST } from "../utils/gst.js";
import { fetchLogoAsDataUri } from "../services/bunnyStorage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const IMAGES_DIR = path.join(__dirname, "..", "images");

const CURRENCY_SYMBOLS = {
  INR: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£",
  AED: "AED",
  AUD: "A$",
  SGD: "S$",
  CAD: "C$",
};

const defaultSections = [
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

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const plain = (value) => {
  if (!value) return {};
  if (typeof value.toObject === "function") return value.toObject();
  return JSON.parse(JSON.stringify(value));
};

const LEGACY_SERVICES_BANNER =
  "SALES AND SERVICE: Solar Products | Security Products | UPS | Batteries | RO Systems | LED Products | Servo Stabilizer | Electric Vehicles | Electrical & Plumbing | Energy Auditing";

const LEGACY_SCOPE_OF_WORK = [
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

const LEGACY_PROCESS_STEPS = [
  { title: "Site Visit", description: "We visit the site to check space availability, roof strength, and electrical setup. This helps us plan the solar installation properly." },
  { title: "Unloading", description: "Our team ensures safe transport using large vehicles, along with careful loading and unloading of solar panels, inverters, and other materials to prevent any damage." },
  { title: "Lifting", description: "We move the solar panels and other materials to the installation area safely using the right equipment." },
  { title: "AC Earth", description: "We install a proper AC earthing system to protect the inverter and electrical components from shocks or damage due to power faults." },
  { title: "DC Earth", description: "A DC earthing system is installed to protect solar panels and wiring from electrical issues, ensuring smooth energy flow." },
  { title: "Lightning Arrester", description: "We install lightning arresters to protect the solar system from lightning strikes, preventing damage to the panels and electrical equipment." },
  { title: "Customized Structure Work", description: "Based on the site's needs, we build strong mounting structures using galvanized pipes. These structures keep the panels secure and last for years." },
  { title: "Panel Installation", description: "Our experts fix the solar panels at the best angle and position to capture maximum sunlight and generate the most power." },
  { title: "Cable Laying", description: "We neatly arrange and connect all cables, ensuring safe and efficient power transmission from the panels to the inverter and main grid." },
  { title: "Net Meter Payment", description: "Our team assists with the net meter payment process and coordinates with the electricity board (EB) or DISCOM." },
  { title: "Commissioning", description: "We check and test the system after installation, making sure everything works correctly before turning it on." },
  { title: "System Configuration", description: "Once the net meter is installed, we set up the system, configure settings, and enable performance monitoring." },
  { title: "Five Years Free Service", description: "We provide free service for five years, including regular maintenance and system checks to ensure long-term performance." },
];

function templateContent(template) {
  const content = template?.content;
  if (!content || typeof content !== "object") return null;
  return Object.keys(content).length ? content : null;
}

function resolveSignatory(company, content) {
  return {
    name:
      String(content?.signatoryName || "").trim() ||
      String(company?.signatoryName || "").trim() ||
      "Authorised Signatory",
    title:
      String(content?.signatoryTitle || "").trim() ||
      String(company?.signatoryTitle || "").trim() ||
      "",
  };
}

function bankDisplayName(bank) {
  return bank?.bankName || bank?.name || "";
}

const toDataUri = (filePath) => {
  try {
    const resolved = path.resolve(filePath);
    const buffer = fs.readFileSync(resolved);
    const ext = path.extname(resolved).slice(1).toLowerCase() || "png";
    const mime = ext === "jpg" ? "jpeg" : ext;
    return `data:image/${mime};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
};

const resolveImage = async (value, fallbackFile) => {
  if (value) {
    if (value.startsWith("data:")) return value;
    if (/^https?:\/\//i.test(value)) {
      // Inline remote logos (e.g. BunnyCDN URLs) as base64 data URIs so they
      // render inside <iframe srcDoc> even when the CDN restricts localhost or
      // null origins. Falls back to the original URL if the backend fetch fails.
      const inlined = await fetchLogoAsDataUri(value);
      return inlined !== null ? inlined : value;
    }
    // Strip file:// prefix for local file URLs so they can be read as base64
    const filePath = value.replace(/^file:\/\/\//, "");
    return toDataUri(filePath);
  }
  if (fallbackFile) {
    return toDataUri(path.join(IMAGES_DIR, fallbackFile));
  }
  return null;
};

const formatDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("en-GB");
};

const currencyCode = (doc, company) =>
  String(doc.currency || company.currency || "INR").toUpperCase();

export const money = (value, currency) => {
  const symbol = CURRENCY_SYMBOLS[currency] || `${currency} `;
  const num = Number(value || 0);
  const formatted = Math.abs(num).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${num < 0 ? "-" : ""}${symbol}${formatted}`;
};

const yesNo = (value) => {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return String(value);
};

export function amountInWords(number, currency = "INR") {
  const MAJOR = {
    INR: "Rupees",
    USD: "US Dollars",
    EUR: "Euros",
    GBP: "British Pounds",
    AED: "UAE Dirhams",
  };
  const MINOR = {
    INR: "Paise",
    USD: "Cents",
    EUR: "Cents",
    GBP: "Pence",
    AED: "Fils",
  };

  const num = Math.abs(Number(number) || 0);
  if (num === 0) return `${MAJOR[currency] || currency} Zero Only`;

  const ones = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen",
  ];
  const tens = [
    "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
  ];

  function convertTwoDigits(n) {
    if (n < 20) return ones[n];
    const unit = n % 10;
    return tens[Math.floor(n / 10)] + (unit ? " " + ones[unit] : "");
  }

  function convertThreeDigits(n) {
    const hundred = Math.floor(n / 100);
    const rest = n % 100;
    let str = "";
    if (hundred > 0) {
      str += ones[hundred] + " Hundred";
      if (rest > 0) str += " ";
    }
    if (rest > 0) {
      str += convertTwoDigits(rest);
    }
    return str;
  }

  const integerPart = Math.floor(num);
  const decimalPart = Math.round((num - integerPart) * 100);

  let crores = Math.floor(integerPart / 10000000);
  let remainder = integerPart % 10000000;

  let lakhs = Math.floor(remainder / 100000);
  remainder = remainder % 100000;

  let thousands = Math.floor(remainder / 1000);
  remainder = remainder % 1000;

  let hundreds = remainder;

  const parts = [];
  if (crores > 0) parts.push(convertThreeDigits(crores) + " Crore");
  if (lakhs > 0) parts.push(convertThreeDigits(lakhs) + " Lakh");
  if (thousands > 0) parts.push(convertThreeDigits(thousands) + " Thousand");
  if (hundreds > 0) parts.push(convertThreeDigits(hundreds));

  const major = MAJOR[currency] || currency;
  const minor = MINOR[currency] || "Cents";

  let words = parts.join(" ").trim();
  const prefix = `${major} `;
  let result = prefix + (words || "Zero");

  if (decimalPart > 0) {
    result += " and " + minor + " " + convertTwoDigits(decimalPart);
  }

  return result + " Only";
}

export function computeGstBreakup(items = [], doc = {}) {
  const taxType =
    String(doc.taxType || TAX_TYPE_CGST_SGST).toLowerCase() === TAX_TYPE_IGST
      ? TAX_TYPE_IGST
      : TAX_TYPE_CGST_SGST;
  const docTaxRate = Number(
    doc.taxPercent ??
      (doc.taxTotal && doc.subTotal
        ? (doc.taxTotal / doc.subTotal) * 100
        : doc.taxAmount && doc.subTotal
        ? (doc.taxAmount / doc.subTotal) * 100
        : 0) ??
      0
  );
  // Legacy detection: an invoice whose every line is 0/unset while the
  // document carries a positive rate is treated as "not yet migrated" and
  // inherits the document rate for all lines.
  const anyNonZero = items.some(
    (i) => i.taxPercent !== null && i.taxPercent !== undefined && Number(i.taxPercent) > 0
  );
  const allZeroLegacy =
    items.length > 0 &&
    !anyNonZero &&
    items.every(
      (i) => i.taxPercent === null || i.taxPercent === undefined || Number(i.taxPercent) === 0
    ) &&
    Number.isFinite(docTaxRate) &&
    docTaxRate > 0;
  const groups = new Map();

  for (const item of items) {
    const qty = Number(item.quantity ?? 1);
    const rate = Number(item.rate ?? item.unitPrice ?? 0);
    const baseAmount = Number(item.amount ?? item.taxableAmount ?? item.base ?? qty * (item.rate ?? item.unitPrice ?? 0));
    const discountAmount = Number(item.discountAmount ?? 0);
    const taxableValue = Number((baseAmount - discountAmount).toFixed(2));
    const rawLineRate = item.taxPercent ?? item.taxRate;
    let taxRate;
    if (rawLineRate === null || rawLineRate === undefined) {
      taxRate = Number.isFinite(docTaxRate) ? docTaxRate : 0;
    } else if (Number(rawLineRate) === 0 && allZeroLegacy) {
      taxRate = Number.isFinite(docTaxRate) ? docTaxRate : 0;
    } else {
      taxRate = Number(rawLineRate);
    }
    const taxAmount = Number(
      item.taxAmount ??
      Math.round(taxableValue * (taxRate / 100) * 100) / 100
    );
    const hsn =
      item.hsnSac ||
      item.hsnCode ||
      item.hsn ||
      item.customFields?.hsnSac ||
      item.customFields?.hsnCode ||
      item.customFields?.hsn ||
      doc.defaultHsnSac ||
      "";

    const key = `${taxRate}|${hsn}`;
    const existing = groups.get(key) || {
      taxType,
      taxRate,
      hsn,
      taxableValue: 0,
      cgstRate: TAX_TYPE_CGST_SGST === taxType ? taxRate / 2 : 0,
      sgstRate: TAX_TYPE_CGST_SGST === taxType ? taxRate / 2 : 0,
      cgstAmount: 0,
      sgstAmount: 0,
      igstRate: TAX_TYPE_CGST_SGST === taxType ? 0 : taxRate,
      igstAmount: 0,
      totalTax: 0,
    };

    existing.taxableValue = Number((existing.taxableValue + taxableValue).toFixed(2));
    groups.set(key, existing);
  }

  const breakup = [];
  let totalTaxable = 0;
  let totalCgst = 0;
  let totalSgst = 0;
  let totalIgst = 0;
  let totalTax = 0;

  for (const [, grp] of groups.entries()) {
    const cgstRate = grp.cgstRate;
    const sgstRate = grp.sgstRate;
    const igstRate = grp.igstRate;
    const halfRate = grp.cgstRate;
    const cgst = TAX_TYPE_CGST_SGST === grp.taxType
      ? Math.round(grp.taxableValue * (halfRate / 100) * 100) / 100
      : 0;
    const sgst = TAX_TYPE_CGST_SGST === grp.taxType
      ? Math.round(grp.taxableValue * (sgstRate / 100) * 100) / 100
      : 0;
    const igst = TAX_TYPE_IGST === grp.taxType
      ? Math.round(grp.taxableValue * (igstRate / 100) * 100) / 100
      : 0;
    const tax = Math.round((cgst + sgst + igst) * 100) / 100;

    grp.cgstAmount = cgst;
    grp.sgstAmount = sgst;
    grp.igstAmount = igst;
    grp.totalTax = tax;

    totalTaxable += grp.taxableValue;
    totalCgst += cgst;
    totalSgst += sgst;
    totalIgst += igst;
    totalTax += tax;

    breakup.push(grp);
  }

  // Reconcile the breakup total with the invoice's stored tax amount so the
  // rendered total tax always matches the stored value (handles legacy data).
  const storedTaxAmount = Number(doc.taxAmount);
  const reconciledTotalTax =
    Number.isFinite(storedTaxAmount) && storedTaxAmount >= 0 && items.length > 0
      ? storedTaxAmount
      : totalTax;

  return {
    breakup,
    totalTaxable,
    totalCgst,
    totalSgst,
    totalIgst,
    totalTax: reconciledTotalTax,
    taxType,
  };
}

function renderGstBreakupBlock(items = [], doc = {}, currency = "INR") {
  const showGstBreakup = doc?.showGstBreakup !== false;
  // Default to showing GST breakup for generated documents unless explicitly disabled.
  const enabled = showGstBreakup !== false;
  if (!enabled) return "";

  const { breakup, totalTaxable, totalCgst, totalSgst, totalIgst, totalTax, taxType } =
    computeGstBreakup(items, doc);
  const isInterState = String(taxType || "").toLowerCase() === TAX_TYPE_IGST;
  const gstCell = (value) =>
    Number(value || 0).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const gstRows = breakup
    .map((grp) => {
      const value = gstCell(grp.taxableValue);
      const tax = gstCell(grp.totalTax);
      return isInterState
        ? `<tr>
            <td class="num">${value}</td>
            <td class="center">${grp.igstRate}%</td>
            <td class="num">${gstCell(grp.igstAmount)}</td>
            <td class="num">${tax}</td>
          </tr>`
        : `<tr>
            <td class="num">${value}</td>
            <td class="center">${grp.cgstRate}%</td>
            <td class="num">${gstCell(grp.cgstAmount)}</td>
            <td class="center">${grp.sgstRate}%</td>
            <td class="num">${gstCell(grp.sgstAmount)}</td>
            <td class="num">${tax}</td>
          </tr>`;
    })
    .join("");

  if (!breakup.length) return "";

  return `<table class="gst-breakup-table" style="width:100%;border-collapse:collapse;">
    <thead>
      <tr>
        <th rowspan="2" style="width:24%;">Taxable Value</th>
        ${
          isInterState
            ? `<th colspan="2">IGST</th>`
            : `<th colspan="2">CGST</th><th colspan="2">SGST/UTGST</th>`
        }
        <th rowspan="2" style="width:20%;">Total Tax Amount</th>
      </tr>
      <tr>
        ${
          isInterState
            ? `<th style="width:12%;">Rate</th><th style="width:16%;">Amount</th>`
            : `<th style="width:12%;">Rate</th><th style="width:16%;">Amount</th><th style="width:12%;">Rate</th><th style="width:16%;">Amount</th>`
        }
      </tr>
    </thead>
    <tbody>
      ${gstRows}
      <tr class="total-row-highlight">
        <td class="num"><strong>Total: ${gstCell(totalTaxable)}</strong></td>
        ${
          isInterState
            ? `<td></td><td class="num"><strong>${gstCell(totalIgst || totalTax)}</strong></td>`
            : `<td></td><td class="num"><strong>${gstCell(totalCgst)}</strong></td><td></td><td class="num"><strong>${gstCell(totalSgst)}</strong></td>`
        }
        <td class="num"><strong>${gstCell(totalTax)}</strong></td>
      </tr>
    </tbody>
  </table>`;
}

function sectionList(template) {
  const sections = Array.isArray(template.sections) && template.sections.length
    ? template.sections
    : defaultSections.map((key, index) => ({ key, enabled: true, order: index }));

  const map = new Map();
  for (const section of sections) {
    if (section?.key) map.set(section.key, section);
  }

  return [...map.values()]
    .filter((section) => section.enabled !== false)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function fieldValue(def, values) {
  const value = values?.[def.key];
  if (value === undefined || value === null || value === "") return "";
  return def.type === "boolean" ? yesNo(value) : String(value);
}

function friendlyLabel(key) {
  return String(key || "")
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]+/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim();
}

function documentFields(template, doc) {
  const defs = (template?.customFields || []).filter(
    (def) => def && def.showOnPdf !== false
  );
  const values = doc?.customFields || {};
  const processedKeys = new Set();
  const rows = [];

  for (const def of defs) {
    if (!def?.key) continue;
    processedKeys.add(def.key);
    const value = fieldValue(def, values);
    if (value !== "") {
      rows.push({ label: def.label || friendlyLabel(def.key), value });
    }
  }

  if (values && typeof values === "object") {
    for (const [key, raw] of Object.entries(values)) {
      if (processedKeys.has(key)) continue;
      if (raw === undefined || raw === null || raw === "") continue;
      const valStr = typeof raw === "boolean" ? yesNo(raw) : String(raw);
      if (valStr) {
        rows.push({ label: friendlyLabel(key), value: valStr });
      }
    }
  }

  return rows;
}

function companyContact(company) {
  return [company.address, company.phone, company.email, company.website, company.gstn ? `GSTIN: ${company.gstn}` : ""]
    .filter(Boolean)
    .map((line) => `<div>${escapeHtml(line)}</div>`)
    .join("");
}

async function renderLogo(company, layout) {
  const icon = await resolveImage(company.logoIconUrl, null);
  const logoText = layout.showLogoText ? await resolveImage(company.logoTextUrl, null) : null;
  const initials = escapeHtml((company.code || company.name || "CO").slice(0, 3).toUpperCase());

  const mark = icon
    ? `<div class="logo-img-wrap"><img src="${icon}" alt="logo" class="logo-icon" onerror="this.style.display='none'" /></div>`
    : `<div class="logo-fallback">${initials}</div>`;

  return `
    <div class="brand-mark">
      ${mark}
      ${logoText ? `<img src="${logoText}" alt="${escapeHtml(company.name)}" class="logo-text" />` : ""}
    </div>`;
}

async function renderHeader({ company, layout, labels, docType }) {
  const title = docType === "invoice" ? labels.invoiceTitle : labels.quotationTitle;
  const align = layout.logoPosition || "left";
  const logo = await renderLogo(company, layout);

  return `
    <header class="doc-header logo-${escapeHtml(align)}">
      <div class="brand">
        ${logo}
        <div class="brand-text">
          <div class="company-name">${escapeHtml(company.name || "Company")}</div>
          ${layout.showTagline && company.tagline ? `<div class="company-tagline">${escapeHtml(company.tagline)}</div>` : ""}
          <div class="company-contact">${companyContact(company)}</div>
        </div>
      </div>
      <div class="doc-title">
        <span>${escapeHtml(title)}</span>
      </div>
    </header>`;
}

function renderMeta({ doc, docType, labels }) {
  const rows =
    docType === "quotation"
      ? [
          ["Quotation No.", doc.quotationNumber],
          ["Issue Date", formatDate(doc.issueDate)],
          ["Valid Until", formatDate(doc.validUntil)],
          ["Status", invoiceStatusLabel(doc.status)],
        ]
      : [
          ["Invoice No.", doc.invoiceNumber],
          ["Invoice Date", formatDate(doc.date)],
          ["Due Date", formatDate(doc.dueDate)],
          ["Status", invoiceStatusLabel(doc.status)],
        ];

  return `
    <section class="meta-grid">
      ${rows
        .filter(([, value]) => value !== undefined && value !== null && value !== "")
        .map(
          ([label, value]) => `
        <div class="meta-item">
          <div class="meta-label">${escapeHtml(label)}</div>
          <div class="meta-value">${escapeHtml(value)}</div>
        </div>`
        )
        .join("")}
    </section>`;
}

function renderClient({ client, labels }) {
  const address = client.address
    ? escapeHtml(client.address).replace(/\n/g, "<br/>")
    : "";
  const contact = [client.phone, client.email, client.gstn ? `GSTIN: ${client.gstn}` : ""]
    .filter(Boolean)
    .map((line) => `<div>${escapeHtml(line)}</div>`)
    .join("");

  return `
    <section class="client-block">
      <div class="section-label">${escapeHtml(labels.clientSectionTitle || "BILL TO")}</div>
      <div class="client-name">${escapeHtml(client.name || "-")}</div>
      ${client.company ? `<div>${escapeHtml(client.company)}</div>` : ""}
      ${address ? `<div class="client-address">${address}</div>` : ""}
      ${contact ? `<div class="client-contact">${contact}</div>` : ""}
    </section>`;
}

function renderItems({ items, docType, template, labels, currency, doc }) {
  const columns = template.columns || {};
  const isQuotation = docType === "quotation";
  const itemDefs = (template.itemCustomFields || []).filter(
    (def) => def && def.showOnPdf !== false
  );
  const columnCustomKeys = new Set(columns.customFields || []);
  const customColumns = itemDefs.filter((def) => columnCustomKeys.has(def.key));
  const descriptionDefs = itemDefs.filter((def) => !columnCustomKeys.has(def.key));

  const head = [
    `<th class="col-index">#</th>`,
    `<th>${escapeHtml(labels.itemDescriptionLabel || "Description")}</th>`,
    columns.category !== false ? `<th>${escapeHtml(labels.itemCategoryLabel || "Category")}</th>` : "",
    isQuotation && columns.itemType ? `<th>Item Type</th>` : "",
    isQuotation && columns.unit !== false ? `<th>${escapeHtml(labels.itemUnitLabel || "Unit")}</th>` : "",
    `<th class="num">${escapeHtml(labels.itemQuantityLabel || "Qty")}</th>`,
    `<th class="num">${escapeHtml(labels.itemRateLabel || "Rate")}</th>`,
    isQuotation && columns.discount !== false
      ? `<th class="num">${escapeHtml(labels.itemDiscountLabel || "Discount")}</th>`
      : "",
    isQuotation && columns.tax !== false
      ? `<th class="num">${escapeHtml(labels.itemTaxLabel || "Tax")}</th>`
      : "",
    ...customColumns.map(
      (def) => `<th>${escapeHtml(def.label || def.key)}</th>`
    ),
    `<th class="num">${escapeHtml(labels.itemAmountLabel || "Amount")}</th>`,
  ]
    .filter(Boolean)
    .join("");

  const rows = items
    .map((item, index) => {
      const rate = item.rate ?? item.unitPrice ?? 0;
      const amount = item.amount ?? item.lineTotal ?? Number(item.quantity || 0) * Number(rate || 0);
      const definedSubLines = descriptionDefs
        .map((def) => {
          const value = fieldValue(def, item.customFields || {});
          return value
            ? `<div class="item-sub"><span>${escapeHtml(def.label || def.key)}:</span> ${escapeHtml(value)}</div>`
            : "";
        })
        .join("");

      const extraItemEntries = Object.entries(item.customFields || {}).filter(
        ([k, v]) =>
          !columnCustomKeys.has(k) &&
          !itemDefs.some((d) => d.key === k) &&
          v !== undefined &&
          v !== null &&
          v !== ""
      );

      const extraSubLines = extraItemEntries
        .map(([k, v]) => {
          const valStr = typeof v === "boolean" ? yesNo(v) : String(v);
          return `<div class="item-sub"><span>${escapeHtml(friendlyLabel(k))}:</span> ${escapeHtml(valStr)}</div>`;
        })
        .join("");

      const subLines = definedSubLines + extraSubLines;

      return `
        <tr>
          <td class="col-index">${index + 1}</td>
          <td class="col-description">${escapeHtml(item.description || "-")}${subLines}</td>
          ${columns.category !== false ? `<td>${escapeHtml(item.category || "-")}</td>` : ""}
          ${isQuotation && columns.itemType ? `<td>${escapeHtml(item.itemType || "-")}</td>` : ""}
          ${isQuotation && columns.unit !== false ? `<td>${escapeHtml(item.unit || "-")}</td>` : ""}
          <td class="num">${escapeHtml(item.quantity ?? 1)}</td>
          <td class="num">${money(rate, currency)}</td>
          ${
            isQuotation && columns.discount !== false
              ? `<td class="num">${money(item.discountAmount || 0, currency)}</td>`
              : ""
          }
          ${
            isQuotation && columns.tax !== false
              ? `<td class="num">${item.taxAmount ? money(item.taxAmount, currency) : `${Number(item.taxPercent != null ? item.taxPercent : (doc?.taxPercent || 0))}%`}</td>`
              : ""
          }
          ${customColumns
            .map((def) => `<td>${escapeHtml(fieldValue(def, item.customFields || {}) || "-")}</td>`)
            .join("")}
          <td class="num">${money(amount, currency)}</td>
        </tr>`;
    })
    .join("");

  return `
    <section class="items-section">
      <table class="items-table">
        <thead><tr>${head}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

function renderTotals({ doc, docType, labels, currency, template }) {
  const isQuotation = docType === "quotation";
  const showPaymentSummary =
    docType === "invoice" && template?.content?.showPaymentSummary !== false;
  const rows = [
    [labels.subTotalLabel || "Sub Total", doc.subTotal || 0],
    ...(Number(doc.discountTotal || 0) > 0
      ? [[labels.itemDiscountLabel || "Discount", -Number(doc.discountTotal || 0)]]
      : []),
    ...(isQuotation
      ? Number(doc.taxTotal || 0) > 0
        ? [[labels.taxTotalLabel || "Tax", doc.taxTotal]]
        : []
      : Number(doc.taxAmount || 0) > 0
        ? [[labels.taxTotalLabel || "Tax", doc.taxAmount]]
        : []),
    ...(isQuotation && Number(doc.shippingCharges || 0) > 0
      ? [["Shipping", doc.shippingCharges]]
      : []),
  ];

  return `
    <section class="totals-wrap">
      <div class="totals">
        ${rows
          .map(
            ([label, value]) => `
          <div class="total-row">
            <span>${escapeHtml(label)}</span>
            <span>${money(value, currency)}</span>
          </div>`
          )
          .join("")}
        <div class="total-row grand">
          <span>${escapeHtml(labels.grandTotalLabel || "Grand Total")}</span>
          <span>${money(doc.grandTotal || 0, currency)}</span>
        </div>
        ${
          showPaymentSummary
            ? `
        <div class="total-row paid">
          <span>Paid</span>
          <span>${money(doc.amountPaid || 0, currency)}</span>
        </div>
        <div class="total-row due">
          <span>Balance Due</span>
          <span>${money(doc.balanceDue || 0, currency)}</span>
        </div>`
            : ""
        }
      </div>
    </section>`;
}

function renderFieldsBlock({ template, doc }) {
  const rows = documentFields(template, doc);
  if (!rows.length) return "";
  return `
    <section class="fields-block">
      ${rows
        .map(
          (row) => `
        <div class="field-item">
          <div class="meta-label">${escapeHtml(row.label)}</div>
          <div class="field-val">${escapeHtml(row.value)}</div>
        </div>`
        )
        .join("")}
    </section>`;
}

function renderBank({ company }) {
  const bank = plain(company.bank);
  const rows = [
    ["Account Name", bank.accountName],
    ["Account Number", bank.accountNumber],
    ["IFSC", bank.ifsc],
    ["Branch", bank.branch],
    ["UPI", bank.upi],
  ].filter(([, value]) => value);

  if (!rows.length) return "";
  return `
    <section class="bank-block">
      <div class="section-label">Bank Details</div>
      ${rows
        .map(
          ([label, value]) => `
        <div class="bank-row">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>`
        )
        .join("")}
    </section>`;
}

function conditionBlock(label, value) {
  if (!value || !String(value).trim()) return "";
  return `
    <div class="condition-block">
      <div class="section-label">${escapeHtml(label)}</div>
      <p>${escapeHtml(value).replace(/\n/g, "<br/>")}</p>
    </div>`;
}

function renderTerms({ doc, docType, labels }) {
  if (docType === "quotation") {
    return `
      <section class="terms-section">
        ${conditionBlock(labels.termsLabel || "Terms & Conditions", doc.termsAndConditions)}
        ${conditionBlock("Delivery Timeline", doc.deliveryTimeline)}
        ${conditionBlock("Payment Terms", doc.paymentTerms)}
        ${conditionBlock("Warranty", doc.warrantyTerms)}
        ${conditionBlock("Exclusions", doc.exclusions)}
      </section>`;
  }
  return `
    <section class="terms-section">
      ${conditionBlock(labels.termsLabel || "Terms & Conditions", doc.terms)}
    </section>`;
}

function renderNotes({ doc, labels }) {
  if (!doc.notes) return "";
  return `
    <section class="notes-section">
      <div class="section-label">${escapeHtml(labels.notesLabel || "Notes")}</div>
      <p>${escapeHtml(doc.notes).replace(/\n/g, "<br/>")}</p>
    </section>`;
}

function renderSignature({ docType, company }) {
  return `
    <section class="signature-section">
      <div class="signature-box">
        <div class="signature-line"></div>
        <div>For ${escapeHtml(company.name || "Company")}</div>
        <div class="muted">Authorised Signatory</div>
      </div>
      ${
        docType === "quotation"
          ? `<div class="signature-box">
              <div class="signature-line"></div>
              <div>Client Acceptance</div>
              <div class="muted">Signature & Date</div>
            </div>`
          : ""
      }
    </section>`;
}

function renderFooter({ template, company }) {
  const text = template.layout?.footerText || company.name || "";
  return `
    <footer class="doc-footer">
      <span>${escapeHtml(text)}</span>
      <span>${escapeHtml(company.website || "")}</span>
    </footer>`;
}

const PRESET_CSS = {
  classic: `
    .doc-header { border-bottom: 3px solid var(--accent); padding-bottom: 14px; }
    .items-table th { background: #f1f5f9; color: var(--secondary); border: 1px solid #cbd5e1; }
    .items-table td { border: 1px solid #e2e8f0; }
  `,
  modern: `
    .doc-header { background: var(--accent); color: #fff; padding: 20px; border-radius: 10px; }
    .doc-header .company-tagline, .doc-header .company-contact, .doc-header .doc-title span { color: rgba(255,255,255,0.9); }
    .items-table th { background: var(--accent); color: #fff; border: none; }
    .items-table td { border-bottom: 1px solid #e2e8f0; }
    .section-label { color: var(--accent); }
  `,
  minimal: `
    .doc-header { border-bottom: 1px solid #cbd5e1; padding-bottom: 12px; }
    .items-table th { background: transparent; color: #475569; border-bottom: 1px solid #94a3b8; text-transform: uppercase; letter-spacing: 0.04em; }
    .items-table td { border-bottom: 1px solid #e2e8f0; }
    .meta-grid, .client-block, .bank-block, .notes-section, .terms-section { background: transparent; border: none; padding-left: 0; }
  `,
  compact: `
    body { font-size: calc(10px * var(--scale)); }
    .doc-header { border-bottom: 2px solid var(--accent); padding-bottom: 8px; }
    .items-table th { background: #f8fafc; border: 1px solid #cbd5e1; padding: 5px 6px; }
    .items-table td { border: 1px solid #e2e8f0; padding: 5px 6px; }
    .section-label { margin-bottom: 3px; }
  `,
  "tax-invoice": `
    body { font-family: Arial, Helvetica, sans-serif; font-size: calc(11px * var(--scale)); line-height: 1.35; }
    .doc-header { border-bottom: none; margin-bottom: 6px; padding-bottom: 0; align-items: center; }
    .header-contact-block { font-size: 0.82em; color: #1e293b; text-align: right; line-height: 1.4; }
    .tax-title-box {
      text-align: center; border: 1.5px solid #000; padding: 4px 8px;
      margin: 6px 0 8px 0; font-size: 1.4em; font-weight: 900;
      letter-spacing: 0.08em; text-transform: uppercase;
    }
    .tax-meta-ribbon {
      background: var(--accent, #00875a); color: #ffffff; display: flex;
      justify-content: space-between; padding: 5px 12px; font-size: 0.88em;
      font-weight: 700; border: 1.5px solid #000; border-bottom: none;
    }
    .tax-address-grid {
      display: grid; grid-template-columns: 1fr 1fr; border: 1.5px solid #000;
      margin-bottom: 0;
    }
    .tax-address-col { padding: 6px 10px; font-size: 0.82em; line-height: 1.35; }
    .tax-address-col:first-child { border-right: 1.5px solid #000; }
    .tax-col-header { font-weight: 700; margin-bottom: 3px; font-size: 0.88em; text-transform: uppercase; color: #000; }
    .tax-subject-row {
      border: 1.5px solid #000; border-top: none; background: #ffffff;
      padding: 5px 10px; font-size: 0.84em; font-weight: 700;
    }
    .tax-items-table {
      width: 100%; border-collapse: collapse; border: 1.5px solid #000;
      border-top: none;
    }
    .tax-items-table th {
      background: var(--accent, #00875a); color: #ffffff; border: 1px solid #000;
      font-size: 0.74em; text-align: center; padding: 5px 3px; font-weight: 700;
    }
    .tax-items-table td {
      border: 1px solid #000; padding: 5px 6px; font-size: 0.8em; vertical-align: top;
    }
    .tax-items-table .num { text-align: right; white-space: nowrap; }
    .tax-items-table .center { text-align: center; }
    .tax-items-table .total-label { font-weight: 700; text-align: right; }
    .total-row-highlight td { font-weight: 700; background: #fafafa; }
    .tax-words-row {
      border: 1.5px solid #000; border-top: none; padding: 5px 10px;
      font-size: 0.82em; background: #ffffff;
    }
    .tax-payment-summary {
      display: flex; justify-content: flex-end; gap: 22px;
      border: 1.5px solid #000; border-top: none; padding: 5px 10px;
      font-size: 0.82em; background: #ffffff;
    }
    .tax-payment-summary span:first-child strong { color: #047857; }
    .tax-payment-summary span:last-child strong { color: #b91c1c; }
    .gst-breakup-table {
      width: 100%; border-collapse: collapse; border: 1px solid #d1d5db;
    }
    .gst-breakup-table th {
      background: #f3f4f6; color: #1e293b; border: 1px solid #d1d5db;
      font-size: 0.72em; text-align: center; padding: 4px 3px; font-weight: 700;
    }
    .gst-breakup-table td {
      border: 1px solid #d1d5db; padding: 4px 6px; font-size: 0.78em;
    }
    .gst-breakup-table .num { text-align: right; white-space: nowrap; }
    .gst-breakup-table .center { text-align: center; }
    .gst-breakup-table .total-row-highlight td { font-weight: 700; background: #f3f4f6; }
    .tax-bank-sign-grid {
      display: grid; grid-template-columns: 1.3fr 1fr; border: 1.5px solid #000;
      border-top: none; margin-bottom: 6px;
    }
    .tax-bank-box { padding: 8px 10px; border-right: 1.5px solid #000; font-size: 0.8em; line-height: 1.4; }
    .tax-sign-box {
      padding: 8px 10px; display: flex; flex-direction: column;
      justify-content: space-between; text-align: right; font-size: 0.8em;
    }
    .tax-services-banner {
      font-size: 0.7em; font-weight: 700; text-align: center;
      color: #0284c7; padding: 5px 4px; margin-top: 6px;
      border-top: 1px solid #cbd5e1;
    }
    .tax-bottom-ribbon {
      background: #0284c7; color: #ffffff; padding: 5px 12px;
      font-size: 0.74em; font-weight: 600; display: flex;
      align-items: center; justify-content: flex-start;
      border-radius: 3px; position: relative; overflow: hidden; margin-top: 4px;
    }
    .tax-bottom-ribbon::after {
      content: ''; position: absolute; right: 0; top: 0; bottom: 0;
      width: 60px; background: var(--accent, #00875a);
      clip-path: polygon(35% 0, 100% 0, 100% 100%, 0% 100%);
    }

    /* Proposal & Scope of Work Layout */
    .proposal-meta-grid {
      display: grid; grid-template-columns: 1.25fr 1fr; border: 1.5px solid #000;
      margin-bottom: 0;
    }
    .proposal-client-col { padding: 6px 10px; font-size: 0.82em; line-height: 1.35; border-right: 1.5px solid #000; }
    .proposal-meta-col { display: flex; flex-direction: column; }
    .proposal-title-bar {
      background: var(--accent, #00875a); color: #fff; font-weight: 900;
      text-align: center; padding: 6px 8px; font-size: 0.95em; letter-spacing: 0.05em;
      border-bottom: 1.5px solid #000; text-transform: uppercase;
    }
    .proposal-meta-rows { padding: 6px 10px; font-size: 0.84em; line-height: 1.5; }
    .proposal-salutation {
      border: 1.5px solid #000; border-top: none; padding: 5px 10px;
      font-size: 0.84em; line-height: 1.4; background: #fff;
    }
    .proposal-items-table {
      width: 100%; border-collapse: collapse; border: 1.5px solid #000; border-top: none;
    }
    .proposal-items-table th {
      background: var(--accent, #00875a); color: #fff; border: 1px solid #000;
      font-size: 0.78em; text-align: center; padding: 5px 4px; font-weight: 700;
    }
    .proposal-items-table td {
      border: 1px solid #000; padding: 5px 6px; font-size: 0.82em; vertical-align: top;
    }
    .prop-total-row td {
      border-top: 1.5px solid #000; font-weight: 700; background: #fafafa;
    }
    .prop-total-label { text-align: right; }
    .prop-total-val { text-align: right; font-weight: 900; }
    .prop-words-row {
      border: 1.5px solid #000; border-top: none; padding: 5px 10px;
      font-size: 0.82em; background: #fff;
    }
    .prop-terms-grid {
      display: grid; grid-template-columns: 1.35fr 1fr; border: 1.5px solid #000;
      border-top: none; font-size: 0.8em; line-height: 1.4;
    }
    .prop-terms-col { padding: 6px 10px; border-right: 1.5px solid #000; }
    .prop-bank-col { padding: 6px 10px; }
    .prop-subhead { font-weight: 800; font-size: 0.88em; text-decoration: underline; margin-bottom: 3px; }
    .milestone-row { display: flex; justify-content: space-between; gap: 8px; margin-top: 2px; }
    .prop-subsidy-box {
      border: 1.5px solid #ca8a04; background: #fef08a; padding: 6px 10px;
      font-size: 0.78em; line-height: 1.4; color: #000; margin-top: 0;
      border-top: none;
    }
    .prop-closing-grid {
      display: grid; grid-template-columns: 1.35fr 1fr; border: 1.5px solid #000;
      border-top: none; font-size: 0.8em; line-height: 1.4;
    }
    .prop-closing-text { padding: 6px 10px; border-right: 1.5px solid #000; display: flex; flex-direction: column; justify-content: space-between; }
    .prop-thank-box {
      border: 1.5px solid #000; text-align: center; font-weight: 900;
      font-size: 1.15em; padding: 4px; margin-top: 6px;
    }
    .prop-sign-box { padding: 6px 10px; display: flex; flex-direction: column; justify-content: space-between; text-align: right; }
    .prop-stamp-space { height: 26px; }
    .page-break { page-break-before: always; margin-top: 18px; padding-top: 10px; border-top: 1px dashed #cbd5e1; }
    .prop-boxed-section {
      border: 1.5px solid #000; padding: 8px 10px; font-size: 0.82em;
    }
    .prop-box-title { font-weight: 800; text-decoration: underline; margin-bottom: 6px; }
    .prop-scope-list { margin: 0; padding-left: 20px; line-height: 1.5; }
    .prop-milestone-table { width: 100%; border-collapse: collapse; }
    .prop-milestone-table td { padding: 4px 6px; border-bottom: 1px solid #e2e8f0; font-size: 0.85em; }
    .prop-milestone-table tr:last-child td { border-bottom: none; }
    .prop-process-title {
      font-weight: 800; font-size: 0.95em; text-align: center; text-decoration: underline;
      margin-bottom: 8px;
    }
    .prop-process-table {
      width: 100%; border-collapse: collapse; border: 1.5px solid #000; font-size: 0.8em;
    }
    .prop-process-table td {
      border: 1px solid #000; padding: 4px 6px; vertical-align: top; line-height: 1.35;
    }
  `,
};

PRESET_CSS.proposal = PRESET_CSS["tax-invoice"];
PRESET_CSS["gst-invoice"] = PRESET_CSS["tax-invoice"];
PRESET_CSS["commercial-proposal"] = PRESET_CSS["proposal"];

const CORPORATE_CSS = `
  .corp-doc { color: #0f172a; }
  .corp-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; padding-bottom: 14px; }
  .corp-brand { display: flex; gap: 14px; align-items: center; }
  .corp-company { font-size: 1.5em; font-weight: 800; letter-spacing: -0.01em; }
  .corp-tagline { font-size: 0.85em; color: #64748b; margin-top: 2px; }
  .corp-title-block { text-align: right; }
  .corp-doc-type { font-size: 1.65em; font-weight: 800; letter-spacing: 0.1em; color: var(--accent); }
  .corp-doc-number { margin-top: 4px; font-size: 0.85em; font-weight: 700; color: #475569; }
  .corp-ribbon { display: flex; justify-content: space-between; padding: 7px 12px; background: var(--secondary); color: #fff; font-size: 0.72em; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
  .corp-meta-grid { display: grid; grid-template-columns: 1.15fr 1fr; border: 1px solid #cbd5e1; border-top: none; }
  .corp-address { padding: 12px 14px; border-right: 1px solid #cbd5e1; }
  .corp-label { font-size: 0.68em; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); margin-bottom: 5px; }
  .corp-client-name { font-size: 1.05em; font-weight: 800; }
  .corp-muted { color: #64748b; font-size: 0.82em; line-height: 1.45; }
  .corp-meta-list { padding: 10px 14px; display: flex; flex-direction: column; gap: 5px; font-size: 0.82em; }
  .corp-meta-list > div { display: flex; justify-content: space-between; gap: 12px; }
  .corp-meta-list span { color: #64748b; }
  .corp-meta-list .corp-subject { display: block; border-top: 1px solid #e2e8f0; padding-top: 5px; }
  .corp-meta-list .corp-subject strong { display: block; margin-top: 2px; }
  .corp-items { width: 100%; border-collapse: collapse; margin-top: 14px; table-layout: fixed; }
  .corp-items th { background: var(--secondary); color: #fff; padding: 8px 7px; font-size: 0.7em; text-transform: uppercase; letter-spacing: 0.05em; text-align: left; }
  .corp-items td { padding: 9px 7px; border-bottom: 1px solid #e2e8f0; font-size: 0.82em; vertical-align: top; }
  .corp-items .num { text-align: right; white-space: nowrap; }
  .corp-items .center { text-align: center; }
  .corp-items .corp-index { width: 34px; color: #94a3b8; }
  .corp-item-title { font-weight: 700; }
  .corp-item-sub { color: #64748b; font-size: 0.9em; margin-top: 2px; }
  .corp-summary { display: grid; grid-template-columns: 1.2fr 1fr; gap: 24px; margin-top: 12px; }
  .corp-note { font-size: 0.8em; color: #475569; line-height: 1.5; }
  .corp-note p { margin: 0 0 8px; }
  .corp-totals { border: 1px solid #cbd5e1; }
  .corp-total-row { display: flex; justify-content: space-between; gap: 12px; padding: 7px 12px; border-bottom: 1px solid #e2e8f0; font-size: 0.84em; }
  .corp-total-row:last-child { border-bottom: 0; }
  .corp-total-row.corp-grand { background: var(--secondary); color: #fff; font-size: 1em; font-weight: 800; }
  .corp-total-row.corp-paid { color: #047857; font-weight: 700; }
  .corp-total-row.corp-due { color: #b91c1c; font-weight: 800; }
  .corp-words { padding: 7px 12px; font-size: 0.72em; color: #64748b; background: #f8fafc; }
  .corp-footer-grid { display: grid; grid-template-columns: 1.15fr 1fr; gap: 24px; margin-top: 18px; padding-top: 14px; border-top: 2px solid var(--accent); }
  .corp-bank > div { display: flex; justify-content: space-between; gap: 12px; font-size: 0.8em; padding: 2px 0; }
  .corp-bank span { color: #64748b; }
  .corp-sign { text-align: right; font-size: 0.85em; }
  .corp-sign-line { height: 42px; }
  .corp-sign strong { display: block; margin-top: 4px; }
  .corp-foot { margin-top: 16px; padding-top: 8px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; gap: 16px; color: #94a3b8; font-size: 0.7em; }

  .corp-premium .corp-head { border-bottom: 6px solid var(--accent); }
  .corp-premium .corp-ribbon { background: var(--secondary); }
  .corp-service .corp-head { border-bottom: 2px solid #e2e8f0; }
  .corp-service .corp-ribbon { background: var(--accent); }
  .corp-service .corp-items th { background: #eff6ff; color: #1e3a8a; border-bottom: 2px solid var(--accent); }
  .corp-service .corp-total-row.corp-grand { background: var(--accent); }
`;

const MINIMAL_CSS = `
  .minimal-doc { color: #1e293b; }
  .minimal-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; }
  .minimal-brand { display: flex; gap: 12px; align-items: center; }
  .minimal-company { font-size: 1.35em; font-weight: 700; letter-spacing: -0.01em; }
  .minimal-tagline { font-size: 0.82em; color: #64748b; }
  .minimal-title { text-align: right; }
  .minimal-title span { display: block; font-size: 1.5em; font-weight: 300; letter-spacing: 0.18em; text-transform: uppercase; color: var(--accent); }
  .minimal-title strong { display: block; margin-top: 4px; font-size: 0.78em; color: #64748b; letter-spacing: 0.05em; }
  .minimal-rule { height: 3px; background: var(--accent); margin: 16px 0 20px; }
  .minimal-meta { display: grid; grid-template-columns: 1.2fr 1fr; gap: 28px; margin-bottom: 24px; }
  .minimal-label { font-size: 0.66em; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #94a3b8; margin-bottom: 5px; }
  .minimal-client { font-size: 1.05em; font-weight: 700; }
  .minimal-muted { color: #64748b; font-size: 0.82em; line-height: 1.45; }
  .minimal-dates > div { display: flex; justify-content: space-between; gap: 12px; font-size: 0.82em; padding: 3px 0; }
  .minimal-dates span { color: #94a3b8; }
  .minimal-dates .minimal-subject { display: block; margin-top: 6px; }
  .minimal-dates .minimal-subject strong { display: block; margin-top: 2px; }
  .minimal-items { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .minimal-items th { padding: 7px 6px; border-bottom: 2px solid var(--secondary); text-align: left; font-size: 0.68em; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b; }
  .minimal-items td { padding: 10px 6px; border-bottom: 1px solid #e2e8f0; font-size: 0.84em; vertical-align: top; }
  .minimal-items .min-index { width: 34px; color: #94a3b8; text-align: right; }
  .minimal-items .num { text-align: right; white-space: nowrap; }
  .minimal-item-title { font-weight: 600; }
  .minimal-item-sub { color: #94a3b8; font-size: 0.9em; margin-top: 2px; }
  .minimal-summary { display: grid; grid-template-columns: 1.2fr 1fr; gap: 30px; margin-top: 18px; }
  .minimal-notes { font-size: 0.8em; color: #475569; }
  .minimal-notes p { margin: 0 0 10px; }
  .minimal-notes ul { margin: 0; padding-left: 16px; line-height: 1.55; }
  .minimal-totals > div { display: flex; justify-content: space-between; gap: 14px; padding: 6px 0; font-size: 0.85em; border-bottom: 1px solid #e2e8f0; }
  .minimal-totals .minimal-grand { border-bottom: none; border-top: 2px solid var(--secondary); margin-top: 4px; padding-top: 9px; font-size: 1.05em; font-weight: 800; }
  .minimal-sign { margin-top: 34px; margin-left: auto; width: 210px; text-align: right; font-size: 0.84em; }
  .minimal-sign-line { height: 38px; }
  .minimal-sign strong { display: block; margin-top: 4px; }
  .minimal-foot { margin-top: 28px; padding-top: 10px; border-top: 1px solid #e2e8f0; display: flex; flex-wrap: wrap; gap: 6px 16px; color: #94a3b8; font-size: 0.7em; }
`;

PRESET_CSS["premium-invoice"] = CORPORATE_CSS;
PRESET_CSS["service-invoice"] = CORPORATE_CSS;
PRESET_CSS["minimal-quotation"] = MINIMAL_CSS;

async function renderTaxInvoiceDocument({ docType, doc, client, company, template, currency, labels, layout }) {
  const isInvoice = docType === "invoice";
  const docNumber = isInvoice ? (doc.invoiceNumber || "-") : (doc.quotationNumber || "-");
  const docDate = isInvoice ? (doc.date || doc.createdAt) : (doc.issueDate || doc.createdAt);
  const title = isInvoice ? (labels.invoiceTitle || "INVOICE") : (labels.quotationTitle || "QUOTATION");
  const items = Array.isArray(doc.lineItems) ? doc.lineItems : (Array.isArray(doc.items) ? doc.items : []);
  const logo = await renderLogo(company, layout);
  const content = templateContent(template);
  const signature = resolveSignatory(company, content);
  const showGstBreakup = content ? content.showGstBreakup !== false : true;
  const showAmountInWords = content ? content.showAmountInWords !== false : true;
  const showBankDetails = content ? content.showBankDetails !== false : true;
  const showSignature = content ? content.showSignature !== false : true;
  const showPaymentSummary = isInvoice && (content ? content.showPaymentSummary !== false : true);
  const servicesBanner = content
    ? String(content.servicesBanner || "").trim()
    : LEGACY_SERVICES_BANNER;
  const showServicesBanner = content
    ? content.showServicesBanner !== false && Boolean(servicesBanner)
    : Boolean(servicesBanner);

  const subject =
    doc.customFields?.subject ||
    content?.subject ||
    doc.customFields?.projectScope ||
    doc.subject ||
    (isInvoice
      ? "Supply, Installation & Commissioning of Commercial Systems."
      : "Supply, Installation & Commissioning of Solar / Commercial Systems.");

  let subtotal = 0;
  let totalGst = 0;
  let grandTotal = 0;

  const itemRows = items.map((item, idx) => {
    const qty = Number(item.quantity ?? 1);
    const unitPrice = Number(item.rate ?? item.unitPrice ?? 0);
    const amount = Number(item.amount ?? qty * unitPrice ?? item.rate ?? 0);
    const taxableValue = Number(
      item.taxableAmount ?? item.taxableValue ?? amount
    );
    const rawLineRate = item.taxPercent ?? item.taxRate;
    const docRate = Number(doc.taxPercent ?? 0);
    let taxRate;
    if (rawLineRate === null || rawLineRate === undefined) {
      taxRate = Number.isFinite(docRate) ? docRate : 0;
    } else if (Number(rawLineRate) === 0) {
      const anyNonZero = items.some(
        (i) => i.taxPercent !== null && i.taxPercent !== undefined && Number(i.taxPercent) > 0
      );
      const allZeroLegacy =
        items.length > 0 &&
        !anyNonZero &&
        items.every((i) => i.taxPercent === null || i.taxPercent === undefined || Number(i.taxPercent) === 0) &&
        Number.isFinite(docRate) &&
        docRate > 0;
      taxRate = allZeroLegacy ? docRate : 0;
    } else {
      taxRate = Number(rawLineRate);
    }
    const taxAmount = Number(
      item.taxAmount ?? Math.round(taxableValue * (taxRate / 100) * 100) / 100
    );
    const lineTotal = Number(
      item.lineTotal ?? taxableValue + taxAmount
    );

    subtotal += taxableValue;
    totalGst += taxAmount;
    grandTotal += lineTotal;

    const hsn =
      item.customFields?.hsnCode ||
      item.hsnCode ||
      item.hsn ||
      doc?.defaultHsnSac ||
      "";
    const unit = item.unit || "Set";

    return `
      <tr>
        <td class="center">${idx + 1}</td>
        <td>
          <strong>${escapeHtml(item.description || item.name || "-")}</strong>
          ${item.itemType ? `<div style="font-size:0.85em;color:#64748b;">${escapeHtml(item.itemType)}</div>` : ""}
        </td>
        <td class="center">${escapeHtml(hsn)}</td>
        <td class="center">${qty} ${escapeHtml(unit)}</td>
        <td class="num">${money(taxableValue, currency)}</td>
        <td class="center">${taxRate}%</td>
        <td class="num">${money(taxAmount, currency)}</td>
        <td class="num">${money(lineTotal, currency)}</td>
      </tr>`;
  }).join("");

  const effectiveGrandTotal = Number(doc.grandTotal ?? grandTotal);
  const effectiveSubtotal = subtotal > 0 ? subtotal : Number(doc.subTotal ?? 0);
  const effectiveTotalTax = Number(doc.taxTotal ?? doc.taxAmount ?? totalGst);

  const { breakup, totalTaxable, totalCgst, totalSgst, totalIgst, totalTax, taxType } = computeGstBreakup(items, doc);
  const isInterState = String(taxType || "").toLowerCase() === TAX_TYPE_IGST;

  const gstCell = (value) =>
    Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const gstRows = breakup.map((grp) => {
    const value = gstCell(grp.taxableValue);
    const tax = gstCell(grp.totalTax);

    if (isInterState) {
      return `
      <tr>
        <td class="num">${value}</td>
        <td class="center">${Number(grp.igstRate || 0).toFixed(2)}%</td>
        <td class="num">${gstCell(grp.igstAmount)}</td>
        <td class="num">${tax}</td>
      </tr>`;
    }

    return `
      <tr>
        <td class="num">${value}</td>
        <td class="center">${Number(grp.cgstRate).toFixed(2)}%</td>
        <td class="num">${gstCell(grp.cgstAmount)}</td>
        <td class="center">${Number(grp.sgstRate).toFixed(2)}%</td>
        <td class="num">${gstCell(grp.sgstAmount)}</td>
        <td class="num">${tax}</td>
      </tr>`;
  }).join("");

  const bank = plain(company.bank) || {};
  const bankLines = [
    bankDisplayName(bank) ? `Bank Name: ${escapeHtml(bankDisplayName(bank))}` : "",
    bank.accountName ? `Account Holder: ${escapeHtml(bank.accountName)}` : "",
    bank.accountNumber ? `Account Number: ${escapeHtml(bank.accountNumber)}` : "",
    bank.ifsc ? `IFSC Code: ${escapeHtml(bank.ifsc)}` : "",
    bank.branch ? `Branch: ${escapeHtml(bank.branch)}` : "",
    bank.upi ? `UPI: ${escapeHtml(bank.upi)}` : "",
  ].filter(Boolean);
  const contactLines = [
    company.phone ? `Phone: ${company.phone}` : "",
    company.gstn ? `GSTIN: ${company.gstn}` : "",
    company.email ? `Email: ${company.email}` : "",
    company.website ? `Web: ${company.website}` : "",
  ].filter(Boolean).map((line) => `<div>${escapeHtml(line)}</div>`).join("");

  const wordsRow = showAmountInWords
    ? `<div class="tax-words-row">
        <strong>Amount in words:</strong> ${amountInWords(effectiveGrandTotal, currency)}
      </div>`
    : "";

  const paymentSummaryRow = showPaymentSummary
    ? `<div class="tax-payment-summary">
        <span>Paid: <strong>${money(doc.amountPaid || 0, currency)}</strong></span>
        <span>Balance Due: <strong>${money(doc.balanceDue || 0, currency)}</strong></span>
      </div>`
    : "";

  const gstBlock = showGstBreakup
    ? `<table class="gst-breakup-table" style="width:100%;border-collapse:collapse;">
      <thead>
        <tr>
          <th rowspan="2" style="width:24%;">Taxable Value</th>
          ${
            isInterState
              ? `<th colspan="2">IGST</th>`
              : `<th colspan="2">CGST</th><th colspan="2">SGST/UTGST</th>`
          }
          <th rowspan="2" style="width:20%;">Total Tax Amount</th>
        </tr>
        <tr>
          ${
            isInterState
              ? `<th style="width:12%;">Rate</th><th style="width:16%;">Amount</th>`
              : `<th style="width:12%;">Rate</th><th style="width:16%;">Amount</th><th style="width:12%;">Rate</th><th style="width:16%;">Amount</th>`
          }
        </tr>
      </thead>
      <tbody>
        ${gstRows}
        <tr class="total-row-highlight">
          <td class="num"><strong>Total: ${gstCell(totalTaxable || effectiveSubtotal)}</strong></td>
          ${
            isInterState
              ? `<td></td><td class="num"><strong>${gstCell(totalIgst || totalTax)}</strong></td>`
              : `<td></td><td class="num"><strong>${gstCell(totalCgst)}</strong></td><td></td><td class="num"><strong>${gstCell(totalSgst)}</strong></td>`
          }
          <td class="num"><strong>${gstCell(totalTax || effectiveTotalTax)}</strong></td>
        </tr>
      </tbody>
    </table>`
    : "";

  const bankBox = showBankDetails && bankLines.length
    ? `<div class="tax-bank-box">
        <strong>Bank Details:</strong>${bankLines
          .map((line) => `<div>${line}</div>`)
          .join("")}
      </div>`
    : "";

  const signBox = showSignature
    ? `<div class="tax-sign-box">
        <div>Thanks for your business.</div>
        <div style="margin-top:24px;">
          <strong>${escapeHtml(signature.name)}</strong>
          ${signature.title ? `<br/><span style="font-size:0.9em;color:#475569;">${escapeHtml(signature.title)}</span>` : ""}
        </div>
      </div>`
    : "";

  const bankSignGrid = bankBox || signBox
    ? `<div class="tax-bank-sign-grid${!bankBox || !signBox ? " single" : ""}">
        ${bankBox}
        ${signBox}
      </div>`
    : "";

  return `
    <header class="doc-header logo-left">
      <div class="brand">
        ${logo}
        <div class="brand-text">
          <div class="company-name">${escapeHtml(company.name || "Company")}</div>
          ${company.tagline ? `<div class="company-tagline">${escapeHtml(company.tagline)}</div>` : ""}
          ${company.address ? `<div class="company-address">${escapeHtml(company.address).replace(/\n/g, "<br/>")}</div>` : ""}
        </div>
      </div>
      <div class="header-contact-block">
        ${contactLines}
      </div>
    </header>

    <div class="tax-title-box">${escapeHtml(title)}</div>

    <div class="tax-meta-ribbon">
      <div><strong>${isInvoice ? "Invoice No:" : "Quotation No:"}</strong> ${escapeHtml(docNumber)}</div>
      <div><strong>Date:</strong> ${formatDate(docDate)}</div>
      ${
        isInterState
          ? `<div><strong>Place of Supply:</strong> ${escapeHtml(client.state || client.company || company.state || "Customer")}</div>`
          : ""
      }
    </div>

    <div class="tax-address-grid">
      <div class="tax-address-col">
        <div class="tax-col-header">Bill To</div>
        <strong>${escapeHtml(client.name || "-")}</strong>
        ${client.company ? `<div>${escapeHtml(client.company)}</div>` : ""}
        ${client.address ? `<div>${escapeHtml(client.address).replace(/\n/g, "<br/>")}</div>` : ""}
        ${client.phone ? `<div>Contact: ${escapeHtml(client.phone)}</div>` : ""}
        ${client.gstn ? `<div>GSTIN: ${escapeHtml(client.gstn)}</div>` : ""}
      </div>
      <div class="tax-address-col">
        <div class="tax-col-header">Ship To</div>
        <strong>${escapeHtml(client.shippingName || client.name || "-")}</strong>
        ${client.company ? `<div>${escapeHtml(client.company)}</div>` : ""}
        ${client.address ? `<div>${escapeHtml(client.address).replace(/\n/g, "<br/>")}</div>` : ""}
        ${client.phone ? `<div>Contact: ${escapeHtml(client.phone)}</div>` : ""}
      </div>
    </div>

    <div class="tax-subject-row">
      <strong>Sub:</strong> ${escapeHtml(subject)}
    </div>

    <table class="tax-items-table">
      <thead>
        <tr>
          <th style="width:36px;">Sl.<br/>No.</th>
          <th>Description</th>
          <th style="width:72px;">HSN/SAC</th>
          <th style="width:58px;">QTY/<br/>Unit</th>
          <th style="width:90px;">Amount<br/>in Rs.</th>
          <th style="width:48px;">GST</th>
          <th style="width:78px;">GST<br/>Amount</th>
          <th style="width:95px;">Total Amount<br/>in Rs.</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
        <tr class="total-row-highlight">
          <td colspan="4" class="total-label"><strong>Total Amount (Including GST)</strong></td>
          <td class="num"><strong>${money(effectiveSubtotal, currency)}</strong></td>
          <td></td>
          <td class="num"><strong>${money(effectiveTotalTax, currency)}</strong></td>
          <td class="num"><strong>${money(effectiveGrandTotal, currency)}</strong></td>
        </tr>
      </tbody>
    </table>

    ${wordsRow}
    ${paymentSummaryRow}
    ${gstBlock}
    ${bankSignGrid}
    ${showServicesBanner ? `<div class="tax-services-banner">${escapeHtml(servicesBanner)}</div>` : ""}

    <div class="tax-bottom-ribbon">
      <span>&#9906; ${escapeHtml(company.address || company.name || "")}</span>
    </div>
  `;
}

async function renderQuotationProposalDocument({ docType, doc, client, company, template, currency, labels, layout }) {
  const docNumber = doc.quotationNumber || doc.invoiceNumber || "-";
  const docDate = doc.issueDate || doc.date || doc.createdAt;
  const title = labels.quotationTitle || "QUOTATION / ESTIMATION";
  const items = Array.isArray(doc.lineItems) ? doc.lineItems : (Array.isArray(doc.items) ? doc.items : []);
  const logo = await renderLogo(company, layout);
  const content = templateContent(template);
  const signature = resolveSignatory(company, content);

  const subject =
    doc.customFields?.subject ||
    content?.subject ||
    doc.customFields?.projectScope ||
    doc.subject ||
    "";

  const scopeOfWork = content ? content.scopeOfWork || [] : LEGACY_SCOPE_OF_WORK;
  const processSteps = content ? content.processSteps || [] : LEGACY_PROCESS_STEPS;
  const legacyMilestones = [];
  const milestones =
    content && Array.isArray(content.paymentMilestones) && content.paymentMilestones.length
      ? content.paymentMilestones
      : content
        ? []
        : legacyMilestones;
  const purposes =
    content && String(content.purposeText || "").trim()
      ? content.purposeText
      : subject
      ? `Please find here below our best proposal for ${subject}.`
      : "Please find here below our best proposal.";
  const closingText =
    content && String(content.closingText || "").trim()
      ? content.closingText
      : "We hope the above offer suits your requirement and expect your valuable order at the earliest.";
  const servicesBanner = content
    ? String(content.servicesBanner || "").trim()
    : LEGACY_SERVICES_BANNER;
  const showServicesBanner = content
    ? content.showServicesBanner !== false && Boolean(servicesBanner)
    : Boolean(servicesBanner);
  const showSignature = content ? content.showSignature !== false : true;
  const showAmountInWords = content ? content.showAmountInWords !== false : true;
  const showBankDetails = content ? content.showBankDetails !== false : true;

  const ebNumber = doc.customFields?.ebNumber || doc.customFields?.connectionNo || client.gstn || "";

  let grandTotal = Number(doc.grandTotal || doc.subTotal || 0);

  const itemRows = items.map((item, idx) => {
    const spec =
      item.customFields?.spec ||
      item.customFields?.deliverableScope ||
      (item.unit ? `${item.quantity} ${item.unit}` : item.quantity ? `${item.quantity} Nos` : "Included");

    const desc = item.description || item.name || "-";
    const itemType = item.itemType ? `<div style="font-size:0.85em;color:#475569;">Make: ${escapeHtml(item.itemType)}</div>` : "";

    return `
      <tr>
        <td class="center" style="width:38px;">${idx + 1}</td>
        <td>
          <div style="font-weight:600;">${escapeHtml(desc).replace(/\n/g, "<br/>")}</div>
          ${itemType}
        </td>
        <td class="center" style="width:130px;font-weight:600;">${escapeHtml(spec)}</td>
      </tr>`;
  }).join("");

  const milestoneRows = milestones.map((milestone, index) => {
    const resolved =
      index === milestones.length - 1
        ? grandTotal -
          milestones.slice(0, index).reduce(
            (sum, item) => sum + Math.round((grandTotal * Number(item.percentage || 0)) / 100),
            0
          )
        : Math.round((grandTotal * Number(milestone.percentage || 0)) / 100);
    return { ...milestone, amount: resolved };
  });

  const bank = plain(company.bank) || {};
  const contactLines = [
    company.phone ? `+91 ${company.phone.replace(/^\+?91/, "").trim()}` : "",
    company.gstn ? `GSTIN:${company.gstn}` : "",
    company.email ? `${company.email}` : "",
    company.website ? `${company.website}` : "",
  ].filter(Boolean).map((line) => `<div>${escapeHtml(line)}</div>`).join("");

  const validityDays = doc.validUntil && doc.issueDate
    ? Math.max(1, Math.round((new Date(doc.validUntil) - new Date(doc.issueDate)) / 86400000))
    : 30;
  const validityText =
    content && String(content.validityText || "").trim()
      ? content.validityText
      : `${validityDays} days`;

  const subsidyNote =
    doc.customFields?.subsidyNote ||
    doc.notes ||
    content?.noticeText ||
    "";

  return `
    <div class="proposal-doc">
      <!-- PAGE 1: Quotation / Estimation Proposal -->
      <div class="proposal-page">
        <header class="doc-header logo-left">
          <div class="brand">
            ${logo}
            <div class="brand-text">
              <div class="company-name">${escapeHtml(company.name || "Company")}</div>
              ${company.tagline ? `<div class="company-tagline">${escapeHtml(company.tagline)}</div>` : ""}
            </div>
          </div>
          <div class="header-contact-block">
            ${contactLines}
          </div>
        </header>

        <div class="proposal-meta-grid">
          <div class="proposal-client-col">
            <div class="prop-label">To,</div>
            <div style="font-weight:700;">${escapeHtml(client.name || "-")},</div>
            ${client.address ? `<div>${escapeHtml(client.address).replace(/\n/g, "<br/>")}</div>` : ""}
            ${client.phone ? `<div>Contact: ${escapeHtml(client.phone)}</div>` : ""}
            ${ebNumber ? `<div style="font-weight:700;margin-top:4px;">EB.NO. : ${escapeHtml(ebNumber)}</div>` : ""}
          </div>
          <div class="proposal-meta-col">
            <div class="proposal-title-bar">${escapeHtml(title)}</div>
            <div class="proposal-meta-rows">
              <div><strong>Quotation No:</strong> <span style="white-space:nowrap;">${escapeHtml(docNumber)}</span></div>
              <div><strong>Date:</strong> ${formatDate(docDate)}</div>
            </div>
          </div>
        </div>

        <div class="proposal-salutation">
          <div>Dear Sir,</div>
          <div>${escapeHtml(purposes)}</div>
        </div>

        <table class="proposal-items-table">
          <thead>
            <tr>
              <th style="width:40px;">Sl. No.</th>
              <th>Item Description</th>
              <th style="width:140px;">SPEC / QTY / PRICE</th>
            </tr>
          </thead>
          <tbody>
            ${itemRows}
            <tr class="prop-total-row">
              <td colspan="2" class="prop-total-label"><strong>Total Amount (Incl. GST)</strong></td>
              <td class="prop-total-val"><strong>${money(grandTotal, currency)}</strong></td>
            </tr>
          </tbody>
        </table>

        ${showAmountInWords
          ? `<div class="prop-words-row">
          <strong>Amount in words:</strong> ${amountInWords(grandTotal, currency)}
        </div>`
          : ""}

        <div class="prop-terms-grid">
          <div class="prop-terms-col">
            <div class="prop-subhead">TERMS AND CONDITIONS:</div>
            <div style="font-weight:700;margin-top:2px;">Payment Mode:</div>
            ${milestoneRows
              .map(
                (milestone) => `<div class="milestone-row">
                  <span>${escapeHtml(milestone.label || "")}</span>
                  <span><strong>${money(milestone.amount, currency)}</strong></span>
                </div>`
              )
              .join("")}
            ${
              doc.deliveryTimeline
                ? `<div style="margin-top:6px;"><strong>Installation:</strong> ${escapeHtml(doc.deliveryTimeline)}</div>`
                : ""
            }
            ${
              doc.warrantyTerms
                ? `<div style="margin-top:4px;"><strong>Warranty:</strong><br/>${escapeHtml(doc.warrantyTerms).replace(/\n/g, "<br/>")}</div>`
                : ""
            }
          </div>

          ${showBankDetails
            ? `<div class="prop-bank-col">
            <div class="prop-subhead">Bank Details:</div>
            <div>Account Name: ${escapeHtml(bank.accountName || company.name || "")},</div>
            ${bank.accountNumber ? `<div>Account No: ${escapeHtml(bank.accountNumber)},</div>` : ""}
            ${bankDisplayName(bank) ? `<div>Bank: ${escapeHtml(bankDisplayName(bank))},</div>` : ""}
            ${bank.branch ? `<div>Branch: ${escapeHtml(bank.branch)},</div>` : ""}
            ${bank.ifsc ? `<div>IFSC Code: ${escapeHtml(bank.ifsc)}</div>` : ""}
            ${bank.upi ? `<div>GPay No: ${escapeHtml(bank.upi)}</div>` : ""}
            <div style="margin-top:8px;"><strong>Validity:</strong> ${escapeHtml(validityText)}</div>
          </div>`
            : ""}
        </div>

        ${
          subsidyNote
            ? `<div class="prop-subsidy-box"><strong>Note:</strong> ${escapeHtml(subsidyNote)}</div>`
            : ""
        }

        <div class="prop-closing-grid">
          <div class="prop-closing-text">
            <div>${escapeHtml(closingText)}</div>
            <div class="prop-thank-box">THANK YOU</div>
          </div>
          ${showSignature
            ? `<div class="prop-sign-box">
            <div>Yours faithfully,</div>
            <div class="prop-stamp-space"></div>
            <div>
              <strong>${escapeHtml(signature.name)}</strong>
              ${signature.title ? `<br/><span style="font-size:0.9em;color:#475569;">${escapeHtml(signature.title)}</span>` : ""}
            </div>
          </div>`
            : ""}
        </div>

        ${showServicesBanner ? `<div class="tax-services-banner">${escapeHtml(servicesBanner)}</div>` : ""}

        <div class="tax-bottom-ribbon">
          <span>&#9906; ${escapeHtml(company.address || company.name || "")}</span>
        </div>
      </div>

      <!-- PAGE 2: Scope of Work Details & Payment Milestones -->
      <div class="proposal-page page-break">
        <header class="doc-header logo-left">
          <div class="brand">
            ${logo}
            <div class="brand-text">
              <div class="company-name">${escapeHtml(company.name || "Company")}</div>
              ${company.tagline ? `<div class="company-tagline">${escapeHtml(company.tagline)}</div>` : ""}
            </div>
          </div>
          <div class="header-contact-block">
            ${contactLines}
          </div>
        </header>

        ${
          scopeOfWork.length
            ? `<div class="prop-boxed-section">
                <div class="prop-box-title">Our Company Scope of Work Details:</div>
                <ol class="prop-scope-list">
                  ${scopeOfWork.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
                </ol>
              </div>`
            : ""
        }

        ${
          milestoneRows.length
            ? `<div class="prop-boxed-section" style="margin-top:10px;">
                <div class="prop-box-title">As per our company norms, the following payment structure is to be followed for project execution:</div>
                <table class="prop-milestone-table">
                  <tr>
                    <td>The total project cost for this ${escapeHtml(subject)} is:</td>
                    <td class="num"><strong>${money(grandTotal, currency)}</strong></td>
                  </tr>
                  ${milestoneRows
                    .map(
                      (milestone) => `<tr>
                        <td><strong>${escapeHtml(milestone.label || "")}:</strong> ${escapeHtml(milestone.description || "")}</td>
                        <td class="num"><strong>${money(milestone.amount, currency)}</strong></td>
                      </tr>`
                    )
                    .join("")}
                </table>
              </div>`
            : ""
        }

        ${
          subsidyNote
            ? `<div class="prop-boxed-section" style="margin-top:10px;">
                <div class="prop-box-title">Note:</div>
                <div style="font-size:0.85em;line-height:1.5;">
                  <p style="margin:0;">${escapeHtml(subsidyNote)}</p>
                </div>
              </div>`
            : ""
        }

        ${showServicesBanner ? `<div class="tax-services-banner" style="margin-top:auto;">${escapeHtml(servicesBanner)}</div>` : ""}

        <div class="tax-bottom-ribbon">
          <span>&#9906; ${escapeHtml(company.address || company.name || "")}</span>
        </div>
      </div>

      <!-- PAGE 3: Scope of Work – Installation Process Breakdown -->
      <div class="proposal-page page-break">
        <header class="doc-header logo-left">
          <div class="brand">
            ${logo}
            <div class="brand-text">
              <div class="company-name">${escapeHtml(company.name || "Company")}</div>
              ${company.tagline ? `<div class="company-tagline">${escapeHtml(company.tagline)}</div>` : ""}
            </div>
          </div>
          <div class="header-contact-block">
            ${contactLines}
          </div>
        </header>

        <div class="prop-process-title">Scope of Work – Installation Process</div>

        <table class="prop-process-table">
          <tbody>
            ${processSteps
              .map(
                (step, index) => `<tr>
                  <td class="center" style="width:30px;">${index + 1}</td>
                  <td>
                    ${step.title ? `<strong>${escapeHtml(step.title)}:</strong> ` : ""}${escapeHtml(step.description || "")}
                  </td>
                </tr>`
              )
              .join("")}
          </tbody>
        </table>

        ${showServicesBanner ? `<div class="tax-services-banner" style="margin-top:auto;">${escapeHtml(servicesBanner)}</div>` : ""}

        <div class="tax-bottom-ribbon">
          <span>&#9906; ${escapeHtml(company.address || company.name || "")}</span>
        </div>
      </div>
    </div>
  `;
}

async function renderCorporateInvoiceDocument({
  docType,
  doc,
  client,
  company,
  template,
  currency,
  labels,
  layout,
  variant = "premium",
}) {
  const isInvoice = docType === "invoice";
  const content = templateContent(template);
  const signature = resolveSignatory(company, content);
  const logo = await renderLogo(company, layout);
  const title = isInvoice
    ? labels.invoiceTitle || "TAX INVOICE"
    : labels.quotationTitle || "QUOTATION";
  const docNumber = isInvoice ? doc.invoiceNumber || "-" : doc.quotationNumber || "-";
  const docDate = isInvoice ? doc.date || doc.createdAt : doc.issueDate || doc.createdAt;
  const items = Array.isArray(doc.lineItems) ? doc.lineItems : [];
  const bank = plain(company.bank) || {};
  const subject = doc.customFields?.subject || content?.subject || doc.subject || "";
  const showBank = content ? content.showBankDetails !== false : true;
  const showSignature = content ? content.showSignature !== false : true;
  const showPaymentSummary =
    isInvoice && (content ? content.showPaymentSummary !== false : true);

  let subTotal = 0;
  let taxTotal = 0;
  let grandTotal = 0;
  const rows = items
    .map((item, index) => {
      const qty = Number(item.quantity ?? 1);
      const rate = Number(item.rate ?? item.unitPrice ?? 0);
      const amount = Number(item.amount ?? item.lineTotal ?? qty * rate);
      const taxRate = Number(item.taxPercent ?? doc.taxPercent ?? 0);
      const taxAmount = Number(
        item.taxAmount ?? Math.round(amount * (taxRate / 100) * 100) / 100
      );
      subTotal += amount;
      taxTotal += taxAmount;
      grandTotal += amount + taxAmount;
      return `<tr>
        <td class="num corp-index">${String(index + 1).padStart(2, "0")}</td>
        <td>
          <div class="corp-item-title">${escapeHtml(item.description || item.name || "-")}</div>
          ${item.itemType ? `<div class="corp-item-sub">${escapeHtml(item.itemType)}</div>` : ""}
        </td>
        <td class="center">${escapeHtml(item.unit || "-")}</td>
        <td class="num">${qty}</td>
        <td class="num">${money(rate, currency)}</td>
        <td class="num">${taxRate}%</td>
        <td class="num">${money(amount + taxAmount, currency)}</td>
      </tr>`;
    })
    .join("");

  const effectiveSub = Number(doc.subTotal ?? subTotal);
  const effectiveTax = Number(doc.taxTotal ?? doc.taxAmount ?? taxTotal);
  const effectiveGrand = Number(doc.grandTotal ?? grandTotal);

  const contactLines = [company.address, company.phone, company.email, company.website, company.gstn ? `GSTIN: ${company.gstn}` : ""]
    .filter(Boolean)
    .map((line) => `<div>${escapeHtml(line)}</div>`)
    .join("");

  const bankRows = [
    ["Account Name", bank.accountName || company.name],
    ["Account No", bank.accountNumber],
    ["Bank", bankDisplayName(bank)],
    ["Branch", bank.branch],
    ["IFSC", bank.ifsc],
    ["UPI", bank.upi],
  ].filter(([, value]) => value);

  return `
    <div class="corp-doc corp-${escapeHtml(variant)}">
      <header class="corp-head">
        <div class="corp-brand">
          ${logo}
          <div>
            <div class="corp-company">${escapeHtml(company.name || "Company")}</div>
            ${company.tagline ? `<div class="corp-tagline">${escapeHtml(company.tagline)}</div>` : ""}
          </div>
        </div>
        <div class="corp-title-block">
          <div class="corp-doc-type">${escapeHtml(title)}</div>
          <div class="corp-doc-number">${escapeHtml(docNumber)}</div>
        </div>
      </header>

      <div class="corp-ribbon">
        <span>${escapeHtml(isInvoice ? "INVOICE" : "QUOTATION")} DETAILS</span>
        <span>${formatDate(docDate)}</span>
      </div>

      <div class="corp-meta-grid">
        <div class="corp-address">
          <div class="corp-label">${escapeHtml(labels.clientSectionTitle || "BILL TO")}</div>
          <div class="corp-client-name">${escapeHtml(client.name || "-")}</div>
          ${client.company ? `<div>${escapeHtml(client.company)}</div>` : ""}
          ${client.address ? `<div class="corp-muted">${escapeHtml(client.address).replace(/\n/g, "<br/>")}</div>` : ""}
          ${client.phone ? `<div class="corp-muted">${escapeHtml(client.phone)}</div>` : ""}
          ${client.gstn ? `<div class="corp-muted">GSTIN: ${escapeHtml(client.gstn)}</div>` : ""}
        </div>
        <div class="corp-meta-list">
          <div><span>Date</span><strong>${formatDate(docDate)}</strong></div>
          ${isInvoice && doc.dueDate ? `<div><span>Due Date</span><strong>${formatDate(doc.dueDate)}</strong></div>` : ""}
          ${!isInvoice && doc.validUntil ? `<div><span>Valid Until</span><strong>${formatDate(doc.validUntil)}</strong></div>` : ""}
          <div><span>Status</span><strong>${escapeHtml(invoiceStatusLabel(doc.status))}</strong></div>
          ${subject ? `<div class="corp-subject"><span>Subject</span><strong>${escapeHtml(subject)}</strong></div>` : ""}
        </div>
      </div>

      <table class="corp-items">
        <thead>
          <tr>
            <th class="num corp-index">#</th>
            <th>Description</th>
            <th class="center">Unit</th>
            <th class="num">Qty</th>
            <th class="num">Rate</th>
            <th class="num">Tax</th>
            <th class="num">Amount</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="corp-summary">
        <div class="corp-note">
          ${
            content?.closingText
              ? `<p>${escapeHtml(content.closingText)}</p>`
              : doc.notes
                ? `<p>${escapeHtml(doc.notes).replace(/\n/g, "<br/>")}</p>`
                : ""
          }
          ${company.gstn ? `<div class="corp-muted">GSTIN: ${escapeHtml(company.gstn)}</div>` : ""}
        </div>
        <div class="corp-totals">
          <div class="corp-total-row"><span>Sub Total</span><strong>${money(effectiveSub, currency)}</strong></div>
          ${Number(doc.discountTotal || 0) > 0 ? `<div class="corp-total-row"><span>Discount</span><strong>${money(-Number(doc.discountTotal || 0), currency)}</strong></div>` : ""}
          <div class="corp-total-row"><span>Tax</span><strong>${money(effectiveTax, currency)}</strong></div>
          <div class="corp-total-row corp-grand"><span>${escapeHtml(labels.grandTotalLabel || "Grand Total")}</span><strong>${money(effectiveGrand, currency)}</strong></div>
          ${
            showPaymentSummary
              ? `<div class="corp-total-row corp-paid"><span>Paid</span><strong>${money(doc.amountPaid || 0, currency)}</strong></div>
                 <div class="corp-total-row corp-due"><span>Balance Due</span><strong>${money(doc.balanceDue || 0, currency)}</strong></div>`
              : ""
          }
          ${
            content?.showAmountInWords !== false
              ? `<div class="corp-words">${escapeHtml(amountInWords(effectiveGrand, currency))}</div>`
              : ""
          }
        </div>
      </div>

      ${
        showBank || showSignature
          ? `<div class="corp-footer-grid">
              ${
                showBank && bankRows.length
                  ? `<div class="corp-bank">
                      <div class="corp-label">Bank Details</div>
                      ${bankRows
                        .map(
                          ([label, value]) =>
                            `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
                        )
                        .join("")}
                    </div>`
                  : "<div></div>"
              }
              ${
                showSignature
                  ? `<div class="corp-sign">
                      <div class="corp-sign-line"></div>
                      <div>For ${escapeHtml(company.name || "Company")}</div>
                      <strong>${escapeHtml(signature.name)}</strong>
                      ${signature.title ? `<div class="corp-muted">${escapeHtml(signature.title)}</div>` : ""}
                    </div>`
                  : ""
              }
            </div>`
          : ""
      }

      <footer class="corp-foot">
        <span>${escapeHtml(contactLines.replace(/<[^>]+>/g, " · "))}</span>
        <span>${escapeHtml(company.website || "")}</span>
      </footer>
    </div>`;
}

async function renderMinimalQuotationDocument({ doc, client, company, template, currency, labels, layout }) {
  const content = templateContent(template);
  const signature = resolveSignatory(company, content);
  const logo = await renderLogo(company, layout);
  const items = Array.isArray(doc.lineItems) ? doc.lineItems : [];
  const subject = doc.customFields?.subject || content?.subject || doc.subject || "";

  let subTotal = 0;
  let taxTotal = 0;
  const rows = items
    .map((item, index) => {
      const qty = Number(item.quantity ?? 1);
      const rate = Number(item.rate ?? item.unitPrice ?? 0);
      const amount = Number(item.amount ?? item.lineTotal ?? qty * rate);
      const taxRate = Number(item.taxPercent ?? doc.taxPercent ?? 0);
      const taxAmount = Number(
        item.taxAmount ?? Math.round(amount * (taxRate / 100) * 100) / 100
      );
      subTotal += amount;
      taxTotal += taxAmount;
      return `<tr>
        <td class="min-index">${String(index + 1).padStart(2, "0")}</td>
        <td>
          <div class="min-item-title">${escapeHtml(item.description || item.name || "-")}</div>
          ${item.itemType ? `<div class="min-item-sub">${escapeHtml(item.itemType)}</div>` : ""}
        </td>
        <td class="num">${qty} ${escapeHtml(item.unit || "")}</td>
        <td class="num">${money(rate, currency)}</td>
        <td class="num">${money(amount, currency)}</td>
      </tr>`;
    })
    .join("");

  const effectiveSub = Number(doc.subTotal ?? subTotal);
  const effectiveTax = Number(doc.taxTotal ?? doc.taxAmount ?? taxTotal);
  const effectiveGrand = Number(doc.grandTotal ?? subTotal + taxTotal);

  const terms = [
    doc.paymentTerms ? `Payment: ${doc.paymentTerms}` : "",
    doc.deliveryTimeline ? `Delivery: ${doc.deliveryTimeline}` : "",
    doc.warrantyTerms ? `Warranty: ${doc.warrantyTerms}` : "",
    doc.exclusions ? `Exclusions: ${doc.exclusions}` : "",
    doc.termsAndConditions || "",
  ].filter(Boolean);

  return `
    <div class="minimal-doc">
      <header class="minimal-head">
        <div class="minimal-brand">
          ${logo}
          <div>
            <div class="minimal-company">${escapeHtml(company.name || "Company")}</div>
            ${company.tagline ? `<div class="minimal-tagline">${escapeHtml(company.tagline)}</div>` : ""}
          </div>
        </div>
        <div class="minimal-title">
          <span>${escapeHtml(labels.quotationTitle || "QUOTATION")}</span>
          <strong>${escapeHtml(doc.quotationNumber || "-")}</strong>
        </div>
      </header>

      <div class="minimal-rule"></div>

      <div class="minimal-meta">
        <div>
          <div class="minimal-label">${escapeHtml(labels.clientSectionTitle || "PREPARED FOR")}</div>
          <div class="minimal-client">${escapeHtml(client.name || "-")}</div>
          ${client.company ? `<div>${escapeHtml(client.company)}</div>` : ""}
          ${client.address ? `<div class="minimal-muted">${escapeHtml(client.address).replace(/\n/g, "<br/>")}</div>` : ""}
          ${client.phone ? `<div class="minimal-muted">${escapeHtml(client.phone)}</div>` : ""}
        </div>
        <div class="minimal-dates">
          <div><span>Date</span><strong>${formatDate(doc.issueDate || doc.date || doc.createdAt)}</strong></div>
          <div><span>Valid Until</span><strong>${formatDate(doc.validUntil)}</strong></div>
          ${subject ? `<div class="minimal-subject"><span>Subject</span><strong>${escapeHtml(subject)}</strong></div>` : ""}
        </div>
      </div>

      <table class="minimal-items">
        <thead>
          <tr>
            <th class="min-index">#</th>
            <th>Description</th>
            <th class="num">Qty</th>
            <th class="num">Rate</th>
            <th class="num">Amount</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="minimal-summary">
        <div class="minimal-notes">
          ${content?.closingText ? `<p>${escapeHtml(content.closingText)}</p>` : ""}
          ${
            terms.length
              ? `<div class="minimal-label">Terms</div>
                 <ul>${terms.map((term) => `<li>${escapeHtml(term)}</li>`).join("")}</ul>`
              : ""
          }
        </div>
        <div class="minimal-totals">
          <div><span>Sub Total</span><strong>${money(effectiveSub, currency)}</strong></div>
          <div><span>Tax</span><strong>${money(effectiveTax, currency)}</strong></div>
          <div class="minimal-grand"><span>${escapeHtml(labels.grandTotalLabel || "Grand Total")}</span><strong>${money(effectiveGrand, currency)}</strong></div>
        </div>
      </div>

      <div class="minimal-sign">
        <div class="minimal-sign-line"></div>
        <div>For ${escapeHtml(company.name || "Company")}</div>
        <strong>${escapeHtml(signature.name)}</strong>
        ${signature.title ? `<div class="minimal-muted">${escapeHtml(signature.title)}</div>` : ""}
      </div>

      <footer class="minimal-foot">
        ${[company.address, company.phone, company.email, company.website]
          .filter(Boolean)
          .map((line) => `<span>${escapeHtml(line)}</span>`)
          .join("")}
      </footer>
    </div>`;
}

export function shouldUseExternalFooter(template) {
  const preset = template?.layout?.preset;
  return ![
    "tax-invoice",
    "gst-invoice",
    "proposal",
    "commercial-proposal",
  ].includes(preset);
}

export async function renderDynamicDocumentHTML({ docType, doc, client, company, template }) {
  const safeDoc = plain(doc);
  const safeCompany = plain(company);
  const safeTemplate = plain(template);

  // Resolve company logos up front: remote (CDN) URLs are fetched on the
  // backend and inlined as base64 data URIs before the document HTML is built,
  // so they render reliably in <iframe srcDoc> previews and PDFs.
  safeCompany.logoIconUrl = await resolveImage(safeCompany.logoIconUrl, null);
  safeCompany.logoTextUrl = await resolveImage(safeCompany.logoTextUrl, null);
  const labels = safeTemplate.labels || {};
  const layout = safeTemplate.layout || {};
  const currency = currencyCode(safeDoc, safeCompany);
  if (docType === "invoice") {
    const paymentState = invoicePaymentState(safeDoc);
    safeDoc.amountPaid = paymentState.amountPaid;
    safeDoc.balanceDue = paymentState.balanceDue;
    safeDoc.status = paymentState.status;
  }
  const items = Array.isArray(safeDoc.lineItems) ? safeDoc.lineItems : [];
  const snapshot = safeDoc.clientSnapshot || {};
  const clientData = { ...plain(client), ...snapshot };
  const showAmountInWords = safeTemplate?.content?.showAmountInWords !== false;
  const sections = sectionList(safeTemplate);
  const preserved = new Set(sections.map((section) => section.key));

  const sectionHtml = {
    header: () => renderHeader({ company: safeCompany, layout, labels, docType }),
    meta: () => renderMeta({ doc: safeDoc, docType, labels }),
    client: () => renderClient({ client: clientData, labels }),
    items: () => renderItems({ items, docType, template: safeTemplate, labels, currency, doc: safeDoc }),
    totals: () => renderTotals({ doc: safeDoc, docType, labels, currency, template: safeTemplate }) +
      (safeTemplate?.content?.showGstBreakup !== false
        ? renderGstBreakupBlock(items, safeDoc, currency)
        : "") +
      (showAmountInWords ? `<div class="tax-words-row"><strong>Amount in words:</strong> ${amountInWords(Number(safeDoc.grandTotal || safeDoc.subTotal || 0), currency)}</div>` : ""),
    bank: () => renderBank({ company: safeCompany }),
    notes: () => renderNotes({ doc: safeDoc, labels }),
    terms: () => renderTerms({ doc: safeDoc, docType, labels }),
    signature: () => renderSignature({ docType, company: safeCompany }),
    footer: () => renderFooter({ template: safeTemplate, company: safeCompany }),
    fields: () => renderFieldsBlock({ template: safeTemplate, doc: safeDoc }),
  };

  const pageSize = layout.pageSize === "Letter" ? "Letter" : "A4";
  const orientation = layout.orientation === "landscape" ? "landscape" : "portrait";
  const margins = layout.margins || {};
  const pad = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  const padTop = pad(margins.top, 12);
  const padRight = pad(margins.right, 14);
  const padBottom = pad(margins.bottom, 12);
  const padLeft = pad(margins.left, 14);
  const presetCss = PRESET_CSS[layout.preset] || PRESET_CSS.classic;
  const watermark = layout.watermarkText
    ? `<div class="watermark">${escapeHtml(layout.watermarkText)}</div>`
    : "";

  const preset = layout.preset || "classic";
  const isGstInvoice = preset === "tax-invoice" || preset === "gst-invoice";
  const isProposal = preset === "proposal" || preset === "commercial-proposal";
  const isCorporateInvoice = preset === "premium-invoice" || preset === "service-invoice";
  const isMinimalQuotation = preset === "minimal-quotation";
  const isSpecialDesign =
    isGstInvoice || isProposal || isCorporateInvoice || isMinimalQuotation;

  let body;
  if (isProposal) {
    body = await renderQuotationProposalDocument({
      docType,
      doc: safeDoc,
      client: clientData,
      company: safeCompany,
      template: safeTemplate,
      currency,
      labels,
      layout,
    });
  } else if (isGstInvoice) {
    body = await renderTaxInvoiceDocument({
      docType,
      doc: safeDoc,
      client: clientData,
      company: safeCompany,
      template: safeTemplate,
      currency,
      labels,
      layout,
    });
  } else if (isCorporateInvoice) {
    body = await renderCorporateInvoiceDocument({
      docType,
      doc: safeDoc,
      client: clientData,
      company: safeCompany,
      template: safeTemplate,
      currency,
      labels,
      layout,
      variant: preset === "service-invoice" ? "service" : "premium",
    });
  } else if (isMinimalQuotation) {
    body = await renderMinimalQuotationDocument({
      doc: safeDoc,
      client: clientData,
      company: safeCompany,
      template: safeTemplate,
      currency,
      labels,
      layout,
    });
  } else {
    const sectionResults = await Promise.all(
      sections.map((section) => sectionHtml[section.key]?.() || "")
    );
    body = sectionResults.filter(Boolean).join("");
  }

  // Fields block is always inserted after the client block when present,
  // even if the visual ordering map predates this section.
  const fieldsHtml = renderFieldsBlock({ template: safeTemplate, doc: safeDoc });
  const bodyWithFields = isSpecialDesign
    ? body
    : (fieldsHtml
        ? body.replace(
            /(<section class="client-block">[\s\S]*?<\/section>)/,
            `$1${fieldsHtml}`
          ) || `${body}${fieldsHtml}`
        : body);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(
    docType === "invoice" ? safeDoc.invoiceNumber : safeDoc.quotationNumber
  )}</title>
<style>
  :root {
    --accent: ${layout.accentColor || "#4f46e5"};
    --secondary: ${layout.secondaryColor || "#0f172a"};
    --scale: ${Number(layout.fontScale || 1)};
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: '${escapeHtml(layout.fontFamily || "Helvetica")}', Arial, sans-serif;
    font-size: calc(12px * var(--scale));
    color: #1e293b;
    padding: ${padTop}mm ${padRight}mm ${padBottom}mm ${padLeft}mm;
    line-height: 1.45;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  @page { size: ${pageSize} ${orientation}; margin: 0; }
  .watermark {
    position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
    font-size: 78px; font-weight: 700; color: var(--accent); opacity: 0.06;
    transform: rotate(-28deg); pointer-events: none; z-index: 0;
  }
  .doc-header {
    display: flex; justify-content: space-between; align-items: flex-start;
    gap: 18px; margin-bottom: 12px;
  }
  .doc-header.logo-center { flex-direction: column; align-items: center; text-align: center; }
  .doc-header.logo-right { flex-direction: row-reverse; text-align: right; }
  .brand { display: flex; gap: 14px; align-items: flex-start; }
  .logo-center .brand, .logo-right .brand { justify-content: center; }
  .brand-mark { display: flex; flex-direction: column; gap: 6px; align-items: center; }
  .logo-icon { width: 72px; height: 72px; object-fit: contain; }
  .logo-img-wrap { width: 72px; height: 72px; display: flex; align-items: center; justify-content: center; }
  .logo-text { max-height: 56px; max-width: 220px; object-fit: contain; }
  .logo-fallback {
    width: 54px; height: 54px; border-radius: 12px; background: var(--accent);
    color: #fff; display: flex; align-items: center; justify-content: center;
    font-weight: 700; letter-spacing: 0.04em;
  }
  .company-name { font-size: 1.55em; font-weight: 700; color: var(--secondary); }
  .company-tagline { color: #64748b; font-size: 0.92em; margin-top: 2px; }
  .company-contact { color: #475569; font-size: 0.85em; margin-top: 5px; }
  .doc-title { text-align: right; }
  .logo-center .doc-title, .logo-right .doc-title { text-align: inherit; }
  .doc-title span {
    display: inline-block; font-size: 1.5em; font-weight: 700;
    letter-spacing: 0.08em; color: var(--accent);
  }
  .meta-grid {
    display: grid; grid-template-columns: 1.8fr 1fr 1fr 0.8fr;
    gap: 8px; background: #f8fafc; padding: 10px; border-radius: 8px; margin-bottom: 12px;
  }
  .meta-grid .meta-item:first-child { min-width: 180px; }
  .meta-grid .meta-value { white-space: nowrap; }
  .meta-label, .section-label {
    font-size: 0.72em; text-transform: uppercase; letter-spacing: 0.06em;
    color: #64748b; font-weight: 700; margin-bottom: 3px;
  }
  .meta-value { font-weight: 600; }
  .client-block, .bank-block, .notes-section, .terms-section {
    background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;
    padding: 10px; margin-bottom: 10px;
  }
  .client-name { font-weight: 700; font-size: 1.05em; color: var(--secondary); }
  .client-address, .client-contact { color: #475569; font-size: 0.9em; }
  .fields-block {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 8px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 10px 12px;
    margin-bottom: 14px;
  }
  .field-item {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 7px 10px;
  }
  .field-item .meta-label { margin-bottom: 2px; }
  .field-val { font-weight: 600; font-size: 0.92em; color: var(--secondary); word-break: break-word; }
  .items-section { margin-bottom: 12px; }
  .items-table { width: 100%; border-collapse: collapse; }
  .items-table th {
    text-align: left; padding: 6px; font-size: 0.78em; text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .items-table td { padding: 6px; vertical-align: top; font-size: 0.92em; }
  .items-table .num { text-align: right; white-space: nowrap; }
  .items-table .col-index { width: 28px; text-align: center; }
  .col-description { min-width: 34%; }
  .item-sub {
    margin-top: 3px;
    font-size: 0.8em;
    color: #475569;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    padding: 1px 6px;
    border-radius: 4px;
    margin-right: 4px;
  }
  .item-sub span { color: #64748b; font-weight: 600; }
  .totals-wrap { display: flex; justify-content: flex-end; margin-bottom: 12px; }
  .totals { min-width: 260px; }
  .total-row {
    display: flex; justify-content: space-between; gap: 20px;
    padding: 5px 10px; border-bottom: 1px solid #e2e8f0;
  }
  .total-row.grand {
    background: var(--accent); color: #fff; font-weight: 700;
    border-radius: 6px; margin-top: 6px; border-bottom: none;
  }
  .total-row.paid { color: #047857; font-weight: 600; }
  .total-row.due { color: #b91c1c; font-weight: 700; }
  .bank-row { display: flex; gap: 10px; font-size: 0.9em; margin-top: 3px; }
  .bank-row span { min-width: 110px; color: #64748b; }
  .condition-block { margin-bottom: 10px; }
  .condition-block p, .notes-section p { margin: 0; font-size: 0.9em; color: #334155; white-space: pre-wrap; }
  .signature-section { display: flex; justify-content: space-between; gap: 40px; margin: 8px 0 4px; break-inside: avoid; page-break-inside: avoid; }
  .terms-section { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 10px; }
  .notes-section { padding: 10px; margin-bottom: 10px; }
  .condition-block { margin-bottom: 6px; font-size: 0.85em; }
  .signature-box { min-width: 190px; font-size: 0.88em; }
  .signature-line { border-top: 1px solid #94a3b8; margin-bottom: 5px; }
  .muted { color: #64748b; font-size: 0.9em; }
  .doc-footer {
    margin-top: 18px; padding-top: 8px; border-top: 1px solid #e2e8f0;
    display: flex; justify-content: space-between; color: #64748b; font-size: 0.78em;
  }
  .gst-breakup-table {
    width: 100%; border-collapse: collapse; border: 1px solid #d1d5db; margin-top: 8px;
  }
  .gst-breakup-table th {
    background: #f3f4f6; color: #1e293b; border: 1px solid #d1d5db;
    font-size: 0.78em; text-align: center; padding: 4px 6px; font-weight: 700;
  }
  .gst-breakup-table td {
    border: 1px solid #d1d5db; padding: 4px 6px; font-size: 0.9em;
  }
  .gst-breakup-table .num { text-align: right; white-space: nowrap; }
  .gst-breakup-table .center { text-align: center; }
  .gst-breakup-table .total-row-highlight td { font-weight: 700; background: #f3f4f6; }

  /* Full-page proposal layout: each page owns its padding so the header,
     content and footer stay aligned on every printed page. */
  body.preset-proposal, body.preset-commercial-proposal { padding: 0; }
  .proposal-page {
    width: 210mm; height: 296mm; padding: 9mm 10mm 7mm;
    display: flex; flex-direction: column; box-sizing: border-box;
    page-break-after: always; break-after: page; overflow: hidden;
  }
  .proposal-page:last-child { page-break-after: auto; break-after: auto; }
  .proposal-page .doc-header { flex: 0 0 auto; }
  .proposal-page.page-break { page-break-before: auto; break-before: auto; margin: 0; border-top: 0; }
  .proposal-page .tax-services-banner { margin-top: auto; }
  .proposal-page .tax-bottom-ribbon { flex: 0 0 auto; }

  /* GST invoice: compact enough to stay on one A4 page like the sample. */
  body.preset-tax-invoice, body.preset-gst-invoice { padding: 6mm 8mm; }
  body.preset-tax-invoice .doc-header,
  body.preset-gst-invoice .doc-header { margin-bottom: 2px; }
  body.preset-tax-invoice .tax-items-table td,
  body.preset-gst-invoice .tax-items-table td { padding: 2px 4px; }
  body.preset-tax-invoice .tax-title-box,
  body.preset-gst-invoice .tax-title-box { padding: 2px 8px; margin: 3px 0 4px; }
  body.preset-tax-invoice .tax-bank-sign-grid,
  body.preset-gst-invoice .tax-bank-sign-grid { margin-bottom: 0; }
  body.preset-tax-invoice .tax-services-banner,
  body.preset-gst-invoice .tax-services-banner { margin-top: 4px; }
  .tax-bank-sign-grid.single { grid-template-columns: 1fr; }
  .tax-bank-sign-grid.single .tax-bank-box { border-right: 0; }
  ${presetCss}
</style>
</head>
<body class="preset-${escapeHtml(layout.preset || 'classic')}">
  ${watermark}
  ${bodyWithFields}
</body>
</html>`;
}

function sampleFieldValue(def, index = 0) {
  if (!def?.key) return "";
  if (def.defaultValue !== undefined && def.defaultValue !== null && def.defaultValue !== "") {
    return def.defaultValue;
  }
  if (def.type === "number") return 10 * (index + 1);
  if (def.type === "date") {
    return new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  }
  if (def.type === "select") {
    return def.options?.[0] || "Option 1";
  }
  if (def.type === "boolean") return true;
  return `Sample ${def.label || def.key}`;
}

function sampleFieldValues(defs = [], index = 0) {
  const values = {};
  for (const def of defs) {
    if (def?.key) values[def.key] = sampleFieldValue(def, index);
  }
  return values;
}

export function buildSampleDocument(docType = "quotation", company = {}, template = {}) {
  const currency = company.currency || "INR";
  const docFieldDefs = (template.customFields || []).filter(
    (def) => def && def.showOnPdf !== false
  );
  const itemFieldDefs = (template.itemCustomFields || []).filter(
    (def) => def && def.showOnPdf !== false
  );
  const sampleItemFields = (index) => sampleFieldValues(itemFieldDefs, index);

  const preset = template.layout?.preset;
  if (preset === "proposal" || preset === "commercial-proposal") {
    const proposalContent = template.content || {};
    return {
      currency: "INR",
      status: "sent",
      quotationNumber: "YESYES/457/26-27",
      issueDate: new Date("2026-10-20"),
      validUntil: new Date("2026-11-20"),
      customFields: {
        subject:
          String(proposalContent.subject || "").trim() ||
          "3KW Solar On-Grid System for Domestic",
        ebNumber: "09043025554",
        ...(String(proposalContent.noticeText || "").trim()
          ? {}
          : {
              subsidyNote:
                "For a 3KW solar system, the Central Government subsidy is Rs.78,000/- and the Tamil Nadu Government subsidy is Rs.22,000/- (Subject for availability), making the total subsidy amount Rs.1,00,000/-. The subsidy amount will be credited directly to the customer's bank account.",
            }),
        ...sampleFieldValues(docFieldDefs),
      },
      deliveryTimeline: "Delivery and Installation within 15 Days.",
      warrantyTerms: "Solar Panels: 30 Years / 25 Years\nSolar On grid Inverter - 10 Years",
      clientSnapshot: {
        name: "Mrs. L.Navaneeth",
        company: "",
        address: "144, panneer nagar, Mogappaire,\nChennai, Tamilnadu.",
        phone: "9944690456",
        gstn: "09043025554",
      },
      lineItems: [
        {
          description: "3KW – DCR Bifacial Panel with Linear power panels",
          itemType: "Vikram",
          unit: "WP",
          quantity: 3000,
          unitPrice: 0,
          rate: 0,
          amount: 0,
          lineTotal: 0,
          customFields: { spec: "3,000 WP", ...sampleItemFields(0) },
        },
        {
          description: "3KW - Solar ON GRID Inverter with WIFI",
          itemType: "Growatt / Standard",
          unit: "W",
          quantity: 3000,
          unitPrice: 0,
          rate: 0,
          amount: 0,
          lineTotal: 0,
          customFields: { spec: "3,000 W", ...sampleItemFields(1) },
        },
        {
          description: "3KW ACDB / DCDB Box",
          itemType: "Standard",
          unit: "Set",
          quantity: 1,
          unitPrice: 0,
          rate: 0,
          amount: 0,
          lineTotal: 0,
          customFields: { spec: "1 Set" },
        },
        {
          description: "6SQMM - DC Cable (Red & Black)",
          itemType: "Polycab",
          unit: "",
          quantity: 1,
          unitPrice: 0,
          rate: 0,
          amount: 0,
          lineTotal: 0,
          customFields: { spec: "As required" },
        },
        {
          description: "MC4 Connectors (Male & Female)",
          itemType: "Standard",
          unit: "",
          quantity: 1,
          unitPrice: 0,
          rate: 0,
          amount: 0,
          lineTotal: 0,
          customFields: { spec: "As required" },
        },
        {
          description: "Customized Galvanized Mounting Structure for 3KW Panels [Height: 9 X 7]",
          itemType: "Galvanized",
          unit: "Lot",
          quantity: 1,
          unitPrice: 0,
          rate: 0,
          amount: 0,
          lineTotal: 0,
          customFields: { spec: "1 Lot" },
        },
        {
          description: "Earthing & Lightning Arrester [AC Earthing, DC Earthing & Lightening Earthing]",
          itemType: "Standard",
          unit: "",
          quantity: 1,
          unitPrice: 0,
          rate: 0,
          amount: 0,
          lineTotal: 0,
          customFields: { spec: "As per Std" },
        },
        {
          description: "Installation & Commissioning",
          itemType: "",
          unit: "",
          quantity: 1,
          unitPrice: 0,
          rate: 0,
          amount: 0,
          lineTotal: 0,
          customFields: { spec: "Included" },
        },
        {
          description: "Net Meter Payment & Process",
          itemType: "",
          unit: "",
          quantity: 1,
          unitPrice: 0,
          rate: 0,
          amount: 0,
          lineTotal: 0,
          customFields: { spec: "Included" },
        },
        {
          description: "Civil Work",
          itemType: "",
          unit: "",
          quantity: 1,
          unitPrice: 0,
          rate: 0,
          amount: 0,
          lineTotal: 0,
          customFields: { spec: "Included" },
        },
      ],
      subTotal: 200000,
      grandTotal: 200000,
      taxTotal: 0,
    };
  }

  if (
    preset === "tax-invoice" ||
    preset === "gst-invoice" ||
    preset === "premium-invoice" ||
    preset === "service-invoice"
  ) {
    return {
      currency: "INR",
      status: "sent",
      invoiceNumber: "YESYES/094/26-27",
      quotationNumber: "YESYES-QTN-2026-094",
      date: new Date(),
      issueDate: new Date(),
      dueDate: new Date(Date.now() + 15 * 86400000),
      validUntil: new Date(Date.now() + 30 * 86400000),
      customFields: {
        subject: "Supply, Installation & Commissioning of 5KW Solar On-grid System.",
        ...sampleFieldValues(docFieldDefs),
      },
      clientSnapshot: {
        name: "Mr. Mohamed Bilal Pichai Mohamed",
        company: "",
        address: "No: 6/11, Bharathi Nagar, Kuthampoondi Road,\nVikkiravandi, Villupuram, Tamilnadu 605652",
        phone: "9944690456",
        gstn: "",
      },
      lineItems: [
        {
          description: "585 Watts Solar Panels, Make: Waaree, 9 Nos\n5KW Solar Inverter, Hawells 1 No",
          category: "other",
          itemType: "Solar System",
          unit: "Set",
          quantity: 1,
          unitPrice: 220952.38,
          rate: 220952.38,
          taxPercent: 5,
          taxAmount: 11047.62,
          amount: 220952.38,
          lineTotal: 232000,
          customFields: {
            hsnCode: "85414300",
            ...sampleItemFields(0),
          },
        },
        {
          description: "6SQMM DC Cables 50 Mtrs 5KW ACDB 1 Nos 5KW DCDB 1 Nos\nEarthing Rods 3 Nos Lightening Arrester 1 No Chemical Bags 2 Nos Etc..",
          category: "other",
          itemType: "Electrical Accessories",
          unit: "Set",
          quantity: 1,
          unitPrice: 49152.54,
          rate: 49152.54,
          taxPercent: 18,
          taxAmount: 8847.46,
          amount: 49152.54,
          lineTotal: 58000,
          customFields: {
            hsnCode: "85444220",
            ...sampleItemFields(1),
          },
        },
      ],
      subTotal: 270104.92,
      taxTotal: 19895.08,
      taxAmount: 19895.08,
      grandTotal: 290000,
      notes: "Thanks for your business.",
      terms: "100% against delivery and commissioning.",
    };
  }

  const base = {
    currency,
    status: docType === "invoice" ? "sent" : "sent",
    notes: "Thank you for your business. We look forward to working with you.",
    customFields: sampleFieldValues(docFieldDefs),
    lineItems: [
      {
        description: "Website design and development",
        category: "development",
        itemType: "Service",
        unit: "project",
        quantity: 1,
        unitPrice: 45000,
        rate: 45000,
        discountType: "none",
        discountValue: 0,
        discountAmount: 0,
        taxPercent: 0,
        taxAmount: 0,
        lineTotal: 45000,
        amount: 45000,
        customFields: sampleItemFields(0),
      },
      {
        description: "Monthly digital marketing retainer",
        category: "digital-marketing",
        itemType: "Retainer",
        unit: "month",
        quantity: 3,
        unitPrice: 12000,
        rate: 12000,
        discountType: "none",
        discountValue: 0,
        discountAmount: 0,
        taxPercent: 0,
        taxAmount: 0,
        lineTotal: 36000,
        amount: 36000,
        customFields: sampleItemFields(1),
      },
    ],
    subTotal: 81000,
    grandTotal: 81000,
  };

  if (docType === "invoice") {
    return {
      ...base,
      invoiceNumber: "SAMPLE-2026-0001",
      date: new Date(),
      dueDate: new Date(Date.now() + 15 * 86400000),
      taxPercent: 0,
      taxAmount: 0,
    };
  }

  return {
    ...base,
    quotationNumber: "SAMPLE-QTN-2026-0001",
    issueDate: new Date(),
    validUntil: new Date(Date.now() + 30 * 86400000),
    discountTotal: 0,
    taxTotal: 0,
    shippingCharges: 0,
    termsAndConditions: "This quotation is valid until the date shown above.",
    deliveryTimeline: "Project kickoff within 7 days of approval.",
    paymentTerms: "50% advance, 50% on delivery.",
    warrantyTerms: "",
    exclusions: "Third-party tools and subscriptions are billed separately.",
    clientSnapshot: {
      name: "Sample Client",
      company: "Acme Pvt Ltd",
      address: "12 MG Road\nBengaluru 560001",
      email: "client@example.com",
      phone: "+91 98765 43210",
      gstn: "29ABCDE1234F1Z5",
    },
  };
}

export { escapeHtml };
