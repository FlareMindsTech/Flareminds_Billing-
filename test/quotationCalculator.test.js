import test from "node:test";
import assert from "node:assert/strict";
import {
  computeQuotationTotals,
  roundMoney,
} from "../services/quotationCalculator.js";
import { quotationNumberFor } from "../services/quotationNumber.js";

const item = (overrides = {}) => ({
  description: "Generic item",
  category: "other",
  unit: "unit",
  quantity: 1,
  unitPrice: 100,
  discountType: "none",
  discountValue: 0,
  taxPercent: 0,
  ...overrides,
});

test("roundMoney rounds half-up at 2 decimals", () => {
  assert.equal(roundMoney(1.005), 1.01);
  assert.equal(roundMoney(2.675), 2.68);
  assert.equal(roundMoney(0), 0);
});

test("computes no-discount, no-tax totals", () => {
  const result = computeQuotationTotals([
    item({ quantity: 3, unitPrice: 250.5 }),
    item({ quantity: 1, unitPrice: 49.99 }),
  ]);
  assert.equal(result.subTotal, 801.49);
  assert.equal(result.discountTotal, 0);
  assert.equal(result.taxTotal, 0);
  assert.equal(result.grandTotal, 801.49);
});

test("applies percent discount once, before tax", () => {
  const result = computeQuotationTotals([
    item({ quantity: 2, unitPrice: 1000, discountType: "percent", discountValue: 10, taxPercent: 18 }),
  ]);
  assert.equal(result.subTotal, 2000);
  assert.equal(result.items[0].discountAmount, 200);
  assert.equal(result.taxTotal, 324);
  assert.equal(result.items[0].lineTotal, 2124);
  assert.equal(result.grandTotal, 2124);
});

test("caps amount discount at the line base", () => {
  const result = computeQuotationTotals([
    item({ quantity: 1, unitPrice: 500, discountType: "amount", discountValue: 900, taxPercent: 10 }),
  ]);
  assert.equal(result.items[0].discountAmount, 500);
  assert.equal(result.items[0].taxAmount, 0);
  assert.equal(result.grandTotal, 0);
});

test("caps percent discount at 100%", () => {
  const result = computeQuotationTotals([
    item({ quantity: 2, unitPrice: 99.99, discountType: "percent", discountValue: 100, taxPercent: 18 }),
  ]);
  assert.equal(result.items[0].discountAmount, 199.98);
  assert.equal(result.grandTotal, 0);
});

test("supports fractional quantities and shipping", () => {
  const result = computeQuotationTotals(
    [item({ quantity: 1.5, unitPrice: 1000, taxPercent: 18 })],
    250
  );
  assert.equal(result.subTotal, 1500);
  assert.equal(result.taxTotal, 270);
  assert.equal(result.shippingCharges, 250);
  assert.equal(result.grandTotal, 2020);
});

test("handles large finite amounts without losing 2-decimal precision", () => {
  const result = computeQuotationTotals([
    item({ quantity: 1000, unitPrice: 999999.99, discountType: "percent", discountValue: 12.5, taxPercent: 18 }),
  ]);
  assert.equal(result.subTotal, 999999990);
  assert.equal(result.items[0].discountAmount, 124999998.75);
  assert.equal(result.grandTotal, 1032499989.68);
});

test("zero values are valid", () => {
  const result = computeQuotationTotals([item({ quantity: 1, unitPrice: 0 })]);
  assert.equal(result.subTotal, 0);
  assert.equal(result.grandTotal, 0);
});

test("quotation numbers are year-scoped and zero-padded", () => {
  assert.equal(quotationNumberFor(2026, 1), "FM-QTN-2026-0001");
  assert.equal(quotationNumberFor(2026, 12345), "FM-QTN-2026-12345");
});
