import Counter from "../models/Counter.js";
import Quotation from "../models/Quotation.js";

// Independent quotation sequence, reset per calendar year:
//   <prefix>-<year>-0001
// The counter document key is year-scoped, so a new year starts at 0001
// without ever reusing a number from a previous year. Numbers are never
// reused after deletion; the counter only moves forward.
export const quotationNumberFor = (year, sequence, prefix = "FM-QTN") =>
  `${prefix}-${year}-${String(sequence).padStart(4, "0")}`;

export async function nextQuotationNumber(now = new Date(), company = null) {
  const year = now.getFullYear();
  const prefix = (company?.quotationPrefix || "FM-QTN").trim();

  // If custom company is provided, scope counter key to company
  const isDefaultCompany = !company || !company.code || company.code === "DEFAULT";
  const counterKey = isDefaultCompany
    ? `quotationNumber_${year}`
    : `quotationNumber_${company.code}_${year}`;

  // The unique index on Quotation.quotationNumber is the final authority.
  while (true) {
    const counter = await Counter.findByIdAndUpdate(
      counterKey,
      { $inc: { sequence: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const candidate = quotationNumberFor(year, counter.sequence, prefix);
    const exists = await Quotation.exists({ quotationNumber: candidate });
    if (!exists) return candidate;
  }
}
