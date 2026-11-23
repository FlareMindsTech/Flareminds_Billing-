import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IMAGES_DIR = path.join(__dirname, "..", "images");
const FONTS_DIR = path.join(__dirname, "..", "fonts");
const DEFAULT_LOGO_ICON_PATH = path.join(IMAGES_DIR, "fm logo.png");
const DEFAULT_LOGO_TEXT_PATH = path.join(IMAGES_DIR, "fm flareminds.png");

const toDataUri = (filePath) => {
  try {
    const buffer = fs.readFileSync(path.resolve(filePath));
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const mime = ext === "jpg" ? "jpeg" : ext || "png";
    return `data:image/${mime};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
};

const resolveLogoSrc = (value) => {
  if (!value) return null;
  if (value.startsWith("data:") || /^https?:\/\//i.test(value)) return value;
  return toDataUri(value);
};

const fontToBase64 = (filename) => {
  try {
    const filePath = path.join(FONTS_DIR, filename);
    if (!fs.existsSync(filePath)) return "";
    return fs.readFileSync(filePath).toString("base64");
  } catch {
    return "";
  }
};

const robotoRegular = fontToBase64("Roboto-Regular.ttf");
const robotoBold = fontToBase64("Roboto-Bold.ttf");

// All user-controlled content is escaped before it lands in the PDF HTML.
export const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const formatDate = (date) => {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("en-GB");
};

const currencySymbols = {
  INR: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£",
  AED: "د.إ",
  AUD: "A$",
  SGD: "S$",
};

const number2 = (value) =>
  Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

// Formats an amount in the quotation's currency.
const money = (value, currency = "INR") => {
  const symbol = currencySymbols[(currency || "INR").toUpperCase()];
  return symbol ? `${symbol} ${number2(value)}` : `${currency} ${number2(value)}`;
};

const icons = {
  globe: `<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>`,
  phone: `<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>`,
  mail: `<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>`,
};

const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons[name] || ""}</svg>`;

const conditionBlock = (label, value) => {
  if (!value || !String(value).trim()) return "";
  return `
    <div class="condition-block">
      <div class="section-label">${escapeHtml(label)}</div>
      <div class="title-line"></div>
      <p class="condition-text">${escapeHtml(value).replace(/\n/g, "<br/>")}</p>
    </div>`;
};

export function renderQuotationHTML({ quotation, client = {}, company = {} }) {
  const items = quotation.lineItems || [];
  const snapshot = quotation.clientSnapshot || {};

  const source = {
    name: snapshot.name || client.name || "-",
    company: snapshot.company || client.company || "",
    address: snapshot.address || client.address || "",
    email: snapshot.email || client.email || "",
    whatsapp: snapshot.whatsapp || client.whatsapp || "",
    phone: snapshot.phone || client.phone || "",
    gstn: snapshot.gstn || client.gstn || "",
  };

  const currency = (quotation.currency || "INR").toUpperCase();

  const customLabels = company.customLabels || {};
  const quotationTitle = customLabels.quotationTitle || "QUOTATION";
  const clientSectionTitle = customLabels.clientSectionTitle || "QUOTATION FOR";
  const descLabel = customLabels.itemDescriptionLabel || "DESCRIPTION";
  const catLabel = customLabels.itemCategoryLabel || "CATEGORY";
  const unitLabel = customLabels.itemUnitLabel || "UNIT";
  const qtyLabel = customLabels.itemQuantityLabel || "QTY";
  const rateLabel = customLabels.itemRateLabel || "RATE";
  const discountLabel = customLabels.itemDiscountLabel || "DISCOUNT";
  const taxLabel = customLabels.itemTaxLabel || "TAX";
  const amountLabel = customLabels.itemAmountLabel || "AMOUNT";
  const subTotalLabel = customLabels.subTotalLabel || "SUB TOTAL";
  const taxTotalLabel = customLabels.taxTotalLabel || "TAX";
  const grandTotalLabel = customLabels.grandTotalLabel || "GRAND TOTAL";
  const notesLabel = customLabels.notesLabel || "NOTES";
  const termsLabel = customLabels.termsLabel || "TERMS & CONDITIONS";

  // Document custom field label mapping
  const docDefMap = new Map();
  for (const def of company.customFields || []) {
    if (def.key) docDefMap.set(def.key, def.label || def.key);
  }

  // Line item custom field label mapping
  const itemDefMap = new Map();
  for (const def of company.itemCustomFields || []) {
    if (def.key) itemDefMap.set(def.key, def.label || def.key);
  }

  const customFieldRows = Object.entries(quotation.customFields || {})
    .filter(([_, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `
      <tr>
        <td class="label">${escapeHtml(docDefMap.get(k) || k)}</td>
        <td class="colon">:</td>
        <td class="val">${escapeHtml(String(v))}</td>
      </tr>
    `)
    .join("");

  const logoIconSrc = resolveLogoSrc(
    company.logoIconUrl || company.logoIconPath || DEFAULT_LOGO_ICON_PATH
  );
  const logoTextSrc = resolveLogoSrc(
    company.logoTextUrl || company.logoTextPath || DEFAULT_LOGO_TEXT_PATH
  );

  const logoBlock = logoIconSrc
    ? `<img src="${logoIconSrc}" alt="${escapeHtml(company.name || "")}" class="logo-icon" onerror="this.style.display='none'" />`
    : `<div class="logo-fallback"><span>${escapeHtml(
        (company.name || "FM")
          .split(" ")
          .map((w) => w[0])
          .slice(0, 2)
          .join("")
          .toUpperCase()
      )}</span></div>`;

  const brandTextBlock = logoTextSrc
    ? `<img src="${logoTextSrc}" alt="${escapeHtml(company.name || "")}" class="logo-text" onerror="this.style.display='none'" />`
    : `<p class="company-name">${escapeHtml(company.name || "Company")}</p>`;

  const rows = items.length
    ? items
        .map((item, index) => {
          const discount = Number(item.discountAmount || 0);
          const taxPercent = Number(item.taxPercent || 0);

          const itemCustomEntries = Object.entries(item.customFields || {}).filter(
            ([_, v]) => v !== undefined && v !== null && v !== ""
          );
          const itemCustomPills = itemCustomEntries.length
            ? `<div style="margin-top:1.5mm; display:flex; flex-wrap:wrap; gap:1.5mm;">
                ${itemCustomEntries
                  .map(
                    ([k, v]) =>
                      `<span style="display:inline-block; font-size:7px; color:#475569; background:#f1f5f9; padding:0.5mm 1.5mm; border-radius:1mm; border:1px solid #e2e8f0;"><strong style="color:#0f766e;">${escapeHtml(
                        itemDefMap.get(k) || k
                      )}:</strong> ${escapeHtml(String(v))}</span>`
                  )
                  .join("")}
              </div>`
            : "";

          return `
            <tr>
              <td class="col-num">${String(index + 1).padStart(2, "0")}</td>
              <td class="col-desc">
                <p class="item-name">${escapeHtml(item.description)}</p>
                ${
                  item.itemType
                    ? `<p class="item-sub">${escapeHtml(item.itemType)}</p>`
                    : ""
                }
                ${itemCustomPills}
              </td>
              <td class="col-category">${escapeHtml(item.category || "-")}</td>
              <td class="col-unit">${escapeHtml(item.unit || "-")}</td>
              <td class="col-qty">${Number(item.quantity)}</td>
              <td class="col-rate">${number2(item.unitPrice)}</td>
              <td class="col-discount">${
                discount > 0 ? `- ${number2(discount)}` : "—"
              }</td>
              <td class="col-tax">${taxPercent > 0 ? `${taxPercent}%` : "—"}</td>
              <td class="col-amount">${number2(item.lineTotal)}</td>
            </tr>`;
        })
        .join("")
    : `<tr><td colspan="9" class="empty-row">No items added</td></tr>`;

  const hasShipping = Number(quotation.shippingCharges || 0) > 0;

  const totalsBlock = `
    <div class="totals-box">
      <div class="totals-row"><span>${escapeHtml(subTotalLabel)}</span><span>${money(quotation.subTotal, currency)}</span></div>
      ${
        Number(quotation.discountTotal) > 0
          ? `<div class="totals-row"><span>${escapeHtml(discountLabel)}</span><span>- ${money(quotation.discountTotal, currency)}</span></div>`
          : ""
      }
      ${
        Number(quotation.taxTotal) > 0
          ? `<div class="totals-row"><span>${escapeHtml(taxTotalLabel)}</span><span>${money(quotation.taxTotal, currency)}</span></div>`
          : ""
      }
      ${
        hasShipping
          ? `<div class="totals-row"><span>SHIPPING CHARGES</span><span>${money(quotation.shippingCharges, currency)}</span></div>`
          : ""
      }
      <div class="grand-total-row">
        <span class="label">${escapeHtml(grandTotalLabel)}</span>
        <span class="val">${money(quotation.grandTotal, currency)}</span>
      </div>
    </div>`;

  const conditionsBlock = [
    conditionBlock("PAYMENT TERMS", quotation.paymentTerms),
    conditionBlock("DELIVERY TIMELINE", quotation.deliveryTimeline),
    conditionBlock("WARRANTY TERMS", quotation.warrantyTerms),
    conditionBlock("EXCLUSIONS", quotation.exclusions),
    conditionBlock(notesLabel, quotation.notes),
    conditionBlock(termsLabel, quotation.termsAndConditions),
  ]
    .filter(Boolean)
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />

<style>
${robotoRegular ? `@font-face { font-family: 'Roboto'; src: url('data:font/ttf;charset=utf-8;base64,${robotoRegular}') format('truetype'); font-weight: 400; font-style: normal; }` : ""}
${robotoBold ? `@font-face { font-family: 'Roboto'; src: url('data:font/ttf;charset=utf-8;base64,${robotoBold}') format('truetype'); font-weight: 700; font-style: normal; }` : ""}

* { box-sizing: border-box; }

@page { size: A4; margin: 0 0 12mm 0; }

html, body { margin: 0; padding: 0; width: 210mm; }

body {
  font-family: 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif !important;
  color: #0f172a;
  background: #ffffff;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
  padding-bottom: 24mm;
}

.page-footer {
  position: fixed;
  bottom: 0;
  left: 0;
  width: 210mm;
  padding: 4mm 14mm 5mm 30mm;
  background: #ffffff;
  border-top: 1px solid #e2e8f0;
}

.header { position: relative; padding: 10mm 14mm 6mm; }

.top-right-ribbon {
  position: absolute; top: 0; right: 0; width: 55mm; height: 30mm; pointer-events: none;
}

.top-right-ribbon .shape-light {
  position: absolute; top: 0; right: 0; width: 55mm; height: 30mm;
  background: #5eead4; clip-path: polygon(100% 0, 0 0, 100% 100%);
}

.top-right-ribbon .shape-dark {
  position: absolute; top: 0; right: 0; width: 55mm; height: 30mm;
  background: #0f766e; clip-path: polygon(100% 0, 20% 0, 100% 85%);
}

.header-top { display: flex; justify-content: space-between; align-items: flex-start; }

.brand-block { display: flex; align-items: center; gap: 4mm; }

.logo-icon { width: 14mm; height: 14mm; object-fit: contain; }

.logo-fallback {
  width: 14mm; height: 14mm; border-radius: 2mm;
  background: #0f766e; color: #ffffff;
  display: flex; align-items: center; justify-content: center;
  font-weight: 800; font-size: 14px;
}

.logo-text { height: 11mm; object-fit: contain; }

.company-name { font-size: 15px; font-weight: 800; margin: 0; color: #0a2540; letter-spacing: 0.2px; }

.quote-title-block { text-align: right; margin-right: 28mm; }

.quote-title-block h1 {
  font-size: 26px; font-weight: 900; margin: 0; color: #0a2540;
  letter-spacing: 1.5px; text-transform: uppercase;
}

.quote-title-block .underline { height: 1.5mm; background: #0f766e; margin-top: 1mm; width: 100%; }

.meta-section {
  padding: 6mm 14mm 4mm;
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 10mm;
  align-items: start;
}

.section-label {
  font-size: 9px; font-weight: 800; color: #0f766e;
  letter-spacing: 0.8px; text-transform: uppercase; margin-bottom: 1.5mm;
}

.title-line { height: 0.6mm; background: #0f766e; width: 18mm; margin-bottom: 2.5mm; }

.client-name { font-size: 12px; font-weight: 800; color: #0a2540; margin-bottom: 1mm; }

.client-address { font-size: 8.5px; color: #475569; line-height: 1.45; margin-bottom: 1.5mm; }

.client-contact {
  display: flex; align-items: center; gap: 1.8mm;
  font-size: 8.5px; color: #475569; margin-top: 1mm;
}

.client-contact svg { width: 3mm; height: 3mm; color: #0f766e; }

.quote-details-block { justify-self: end; width: 100%; max-width: 78mm; }

.quote-details-table { width: 100%; border-collapse: collapse; }

.quote-details-table td { padding: 1.2mm 0; font-size: 8.5px; vertical-align: top; }

.quote-details-table .label { font-weight: 700; color: #475569; width: 34mm; }

.quote-details-table .colon { width: 3mm; color: #64748b; }

.quote-details-table .val { font-weight: 600; color: #0a2540; text-align: right; }

.table-section { padding: 4mm 14mm 0; }

.custom-table { width: 100%; border-collapse: collapse; }

.custom-table thead { display: table-header-group; }

.custom-table thead tr { background: #0f766e; }

.custom-table thead th {
  color: #ffffff;
  font-size: 7.5px;
  font-weight: 800;
  padding: 3.5mm 2.5mm;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.custom-table thead th.col-num { width: 9mm; text-align: center; }
.custom-table thead th.col-desc { text-align: left; }
.custom-table thead th.col-category { width: 20mm; text-align: left; }
.custom-table thead th.col-unit { width: 14mm; text-align: left; }
.custom-table thead th.col-qty { width: 11mm; text-align: center; }
.custom-table thead th.col-rate { width: 21mm; text-align: right; }
.custom-table thead th.col-discount { width: 19mm; text-align: right; }
.custom-table thead th.col-tax { width: 12mm; text-align: center; }
.custom-table thead th.col-amount { width: 22mm; text-align: right; }

.custom-table tbody td {
  padding: 3.5mm 2.5mm;
  border-bottom: 1px solid #e2e8f0;
  font-size: 8.5px;
  color: #334155;
  page-break-inside: avoid;
}

.custom-table tbody tr:last-child td { border-bottom: 1px solid #cbd5e1; }

.col-num { text-align: center; font-weight: 800; color: #0f766e; }
.col-desc { text-align: left; }
.col-category { text-align: left; }
.col-unit { text-align: left; }
.col-qty { text-align: center; }
.col-rate { text-align: right; }
.col-discount { text-align: right; }
.col-tax { text-align: center; }
.col-amount { text-align: right; font-weight: 600; }

.item-name { margin: 0; font-weight: 600; color: #0f172a; }

.item-sub { margin: 1.2mm 0 0; font-size: 7.5px; color: #64748b; }

.empty-row { text-align: center; padding: 10mm 6mm; color: #94a3b8; }

.totals-wrapper { padding: 6mm 14mm 0; display: flex; justify-content: flex-end; }

.totals-box { width: 82mm; background: #f0fdfa; border-radius: 1.5mm; overflow: hidden; }

.totals-row {
  display: flex; justify-content: space-between;
  padding: 3mm 4mm;
  font-size: 9px; font-weight: 700; color: #0a2540;
  page-break-inside: avoid;
}

.grand-total-row {
  background: #0f766e; color: #ffffff;
  padding: 3.5mm 4mm;
  display: flex; justify-content: space-between; align-items: center;
  page-break-inside: avoid;
}

.grand-total-row .label { font-size: 9.5px; font-weight: 800; text-transform: uppercase; }
.grand-total-row .val { font-size: 14px; font-weight: 900; }

.bottom-section {
  padding: 8mm 14mm 6mm;
  position: relative;
}

.condition-block {
  margin-bottom: 5mm;
  page-break-inside: avoid;
}

.condition-text { font-size: 8.5px; color: #475569; line-height: 1.5; margin: 0; }

.signature-section {
  padding: 2mm 14mm 8mm;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14mm;
  page-break-inside: avoid;
}

.signature-box { border: 1px solid #e2e8f0; border-radius: 2mm; padding: 5mm; min-height: 32mm; }

.signature-box .signature-label {
  font-size: 9px; font-weight: 800; color: #0a2540;
  text-transform: uppercase; margin: 0 0 4mm;
}

.signature-line {
  margin-top: 10mm;
  border-top: 1px solid #334155;
  padding-top: 2mm;
  font-size: 8px;
  color: #475569;
}

.bottom-left-ribbon-footer {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 35mm;
  height: 20mm;
  pointer-events: none;
}

.bottom-left-ribbon-footer .shape-light {
  position: absolute; bottom: 0; left: 0; width: 35mm; height: 20mm;
  background: #5eead4; clip-path: polygon(0 40%, 0 100%, 75% 100%);
}

.bottom-left-ribbon-footer .shape-dark {
  position: absolute; bottom: 0; left: 0; width: 35mm; height: 20mm;
  background: #0f766e; clip-path: polygon(0 50%, 0 100%, 65% 100%);
}

.footer-inner {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 8px; font-weight: 600; color: #334155;
}

.footer-contact { display: flex; align-items: center; gap: 5mm; }

.footer-item { display: flex; align-items: center; gap: 1.5mm; }

.footer-item svg { width: 3.5mm; height: 3.5mm; color: #0f766e; }

</style>
</head>

<body>

  <!-- HEADER -->
  <div class="header">
    <div class="top-right-ribbon">
      <div class="shape-light"></div>
      <div class="shape-dark"></div>
    </div>

    <div class="header-top">
      <div class="brand-block">
        ${logoBlock}
        <div class="brand-text">
          ${brandTextBlock}
        </div>
      </div>

      <div class="quote-title-block">
        <h1>${escapeHtml(quotationTitle)}</h1>
        <div class="underline"></div>
      </div>
    </div>
  </div>

  <!-- CUSTOMER & QUOTATION METADATA -->
  <div class="meta-section">
    <div class="bill-to-block">
      <div class="section-label">${escapeHtml(clientSectionTitle)}</div>
      <div class="title-line"></div>

      <div class="client-name">${escapeHtml(source.name)}</div>
      ${
        source.company
          ? `<div class="client-address">${escapeHtml(source.company)}</div>`
          : ""
      }
      ${
        source.address
          ? `<div class="client-address">${escapeHtml(source.address).replace(/\n/g, "<br/>")}</div>`
          : ""
      }

      ${
        source.phone
          ? `<div class="client-contact"><span>${icon("phone")}</span><span>${escapeHtml(source.phone)}</span></div>`
          : ""
      }
      ${
        source.email
          ? `<div class="client-contact"><span>${icon("mail")}</span><span>${escapeHtml(source.email)}</span></div>`
          : ""
      }
    </div>

    <div class="quote-details-block">
      <table class="quote-details-table">
        <tr>
          <td class="label">Quotation No.</td>
          <td class="colon">:</td>
          <td class="val">${escapeHtml(quotation.quotationNumber)}</td>
        </tr>
        <tr>
          <td class="label">Issue Date</td>
          <td class="colon">:</td>
          <td class="val">${formatDate(quotation.issueDate)}</td>
        </tr>
        <tr>
          <td class="label">Valid Until</td>
          <td class="colon">:</td>
          <td class="val">${formatDate(quotation.validUntil)}</td>
        </tr>
        <tr>
          <td class="label">Customer GSTIN</td>
          <td class="colon">:</td>
          <td class="val">${escapeHtml(source.gstn || "-")}</td>
        </tr>
        ${customFieldRows}
      </table>
    </div>
  </div>

  <!-- ITEMS TABLE -->
  <div class="table-section">
    <table class="custom-table">
      <thead>
        <tr>
          <th class="col-num">#</th>
          <th class="col-desc">${escapeHtml(descLabel)}</th>
          <th class="col-category">${escapeHtml(catLabel)}</th>
          <th class="col-unit">${escapeHtml(unitLabel)}</th>
          <th class="col-qty">${escapeHtml(qtyLabel)}</th>
          <th class="col-rate">${escapeHtml(rateLabel)}</th>
          <th class="col-discount">${escapeHtml(discountLabel)}</th>
          <th class="col-tax">${escapeHtml(taxLabel)}</th>
          <th class="col-amount">${escapeHtml(amountLabel)}</th>
        </tr>
      </thead>

      <tbody>
        ${rows}
      </tbody>
    </table>
  </div>

  <!-- TOTALS -->
  <div class="totals-wrapper">
    ${totalsBlock}
  </div>

  <!-- CONDITIONS & NOTES -->
  ${conditionsBlock ? `<div class="bottom-section">${conditionsBlock}</div>` : ""}

  <!-- SIGNATURES -->
  <div class="signature-section">
    <div class="signature-box">
      <div class="signature-label">Accepted by (Customer)</div>
      <div class="signature-line">Name / Signature / Date</div>
    </div>

    <div class="signature-box">
      <div class="signature-label">For ${escapeHtml(company.name || "Company")}</div>
      <div class="signature-line">Authorised Signatory</div>
    </div>
  </div>

  <!-- FIXED FOOTER -->
  <div class="page-footer">
    <div class="bottom-left-ribbon-footer">
      <div class="shape-light"></div>
      <div class="shape-dark"></div>
    </div>

    <div class="footer-inner">
      <div class="footer-contact">
        ${
          company.website
            ? `<div class="footer-item">${icon("globe")}${escapeHtml(company.website)}</div>`
            : ""
        }
        ${
          company.phone
            ? `<div class="footer-item">${icon("phone")}${escapeHtml(company.phone)}</div>`
            : ""
        }
        ${
          company.email
            ? `<div class="footer-item">${icon("mail")}${escapeHtml(company.email)}</div>`
            : ""
        }
      </div>

      <div>${escapeHtml(company.name || "Company")}</div>
    </div>
  </div>

</body>
</html>`;
}
