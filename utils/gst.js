// GST state / place-of-supply helpers. All GSTIN values are normalized before
// comparison so a saved value and a derived value can never disagree about the
// 2-digit state code.

import { stateCodeForName } from "./indianStates.js";

export const GSTIN_PATTERN = /^[0-9]{2}[A-Z0-9]{10}[A-Z0-9]{3}$/;

export const TAX_TYPE_CGST_SGST = "cgst_sgst";
export const TAX_TYPE_IGST = "igst";

export const resolveTaxType = ({ company, client } = {}) => {
  const companyCode = resolveStateCode(company);
  const clientCode = resolveStateCode(client);
  const intraState =
    Boolean(companyCode) &&
    Boolean(clientCode) &&
    companyCode === clientCode;

  return intraState ? TAX_TYPE_CGST_SGST : TAX_TYPE_IGST;
};

export const resolvePlaceOfSupply = ({ company, client } = {}) => {
  const taxType = resolveTaxType({ company, client });
  return taxType === TAX_TYPE_CGST_SGST ? "intra_state" : "inter_state";
};

// A valid GSTIN derives the 2-digit state code from its first two digits;
// anything else falls back to the saved state code.
const VALID_GST_STATE_CODES = new Set([
  ...Array.from({ length: 38 }, (_, i) => String(i + 1).padStart(2, "0")),
  "97",
  "99",
]);

export const isValidGstStateCode = (code) =>
  VALID_GST_STATE_CODES.has(String(code || "").trim().toUpperCase());

export const resolveStateCode = (entry = null) => {
  const gstinCode = entry?.gstn
    ? String(normalizeGstin(entry.gstn)?.slice(0, 2) || "")
    : "";
  const savedCode = String(
    entry?.stateCode || entry?.gstStateCode || ""
  ).trim().toUpperCase();
  let code = gstinCode || savedCode;
  if (!(/^[0-9]{2}$/.test(code) && isValidGstStateCode(code))) {
    const fromName = stateCodeForName(entry?.state || entry?.stateName);
    if (fromName) code = fromName;
  }

  return /^[0-9]{2}$/.test(code) && isValidGstStateCode(code) ? code : null;
};

export const resolveStateName = (entry = null) =>
  String(entry?.state || entry?.stateName || "").trim() || null;

// Normalizes a GSTIN to uppercase and strips stray whitespace; returns null when
// it is missing or malformed.
export const normalizeGstin = (value) => {
  const text = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!text || !GSTIN_PATTERN.test(text)) return null;
  return text;
};

// GST split for one taxable base at a given rate. Intra-state applies
// CGST + SGST (half each); inter-state applies a single IGST.
export const computeTaxSplit = (
  taxableAmount,
  taxType = TAX_TYPE_CGST_SGST,
  taxPercent = 0
) => {
  const taxable = Number(taxableAmount) || 0;
  const rate = Number(taxPercent) || 0;
  const tax = Math.round(((taxable * rate) / 100) * 100) / 100;

  if (taxType === TAX_TYPE_IGST) {
    return {
      taxType,
      tax,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: tax,
      cgstRate: 0,
      sgstRate: 0,
      igstRate: rate,
    };
  }

  const halfRate = Math.round((rate / 2) * 100) / 100;
  const cgst = Math.round(((taxable * halfRate) / 100) * 100) / 100;
  const sgst = Math.round(((taxable * halfRate) / 100) * 100) / 100;

  return {
    taxType,
    tax,
    cgstAmount: cgst,
    sgstAmount: sgst,
    igstAmount: 0,
    cgstRate: halfRate,
    sgstRate: halfRate,
    igstRate: 0,
  };
};
