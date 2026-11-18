// Authoritative quotation arithmetic. Every monetary value returned here is
// rounded to 2 decimals (the currency precision used by the rest of the app).
//
// Calculation order per line:
//   1. base       = round2(quantity * unitPrice)
//   2. discount   = none: 0
//                   percent: min(round2(base * value / 100), base)
//                   amount:  min(round2(value), base)
//   3. taxable    = round2(base - discount)
//   4. tax        = round2(taxable * taxPercent / 100)
//   5. lineTotal  = round2(taxable + tax)
// Totals:
//   subTotal      = sum(base)
//   discountTotal = sum(discount)
//   taxTotal      = sum(tax)
//   grandTotal    = round2(subTotal - discountTotal + taxTotal + shipping)
//
// Discounts are applied exactly once, tax is applied to the post-discount
// taxable base only, and the client never supplies any of these totals.

export const roundMoney = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export function computeQuotationTotals(items, shippingCharges = 0) {
  let subTotal = 0;
  let discountTotal = 0;
  let taxTotal = 0;

  const computed = items.map((item) => {
    const base = roundMoney(Number(item.quantity) * Number(item.unitPrice));

    let discountAmount = 0;
    if (item.discountType === "percent") {
      discountAmount = Math.min(
        roundMoney((base * Number(item.discountValue)) / 100),
        base
      );
    } else if (item.discountType === "amount") {
      discountAmount = Math.min(roundMoney(item.discountValue), base);
    }

    const taxable = roundMoney(base - discountAmount);
    const taxAmount = roundMoney((taxable * Number(item.taxPercent ?? 0)) / 100);
    const lineTotal = roundMoney(taxable + taxAmount);

    subTotal = roundMoney(subTotal + base);
    discountTotal = roundMoney(discountTotal + discountAmount);
    taxTotal = roundMoney(taxTotal + taxAmount);

    return {
      ...item,
      discountAmount,
      taxAmount,
      lineTotal,
    };
  });

  const shipping = roundMoney(shippingCharges || 0);
  const grandTotal = roundMoney(subTotal - discountTotal + taxTotal + shipping);

  return {
    items: computed,
    subTotal,
    discountTotal,
    taxTotal,
    shippingCharges: shipping,
    grandTotal,
  };
}
