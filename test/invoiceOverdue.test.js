import test from "node:test";
import assert from "node:assert/strict";

const {
  invoicePaymentState,
  invoiceStatusLabel,
  isInvoiceOverdue,
  withEffectivePaymentFields,
} = await import("../utils/invoicePayments.js");

const NOW = new Date(2026, 10, 17, 10, 30, 0);
const dayOffset = (offset) => {
  const date = new Date(NOW);
  date.setDate(date.getDate() + offset);
  return date;
};

const partiallyPaidPastDue = (overrides = {}) => ({
  status: "partially_paid",
  grandTotal: 1000,
  amountPaid: 250,
  balanceDue: 750,
  dueDate: dayOffset(-1),
  ...overrides,
});

test("a partially paid invoice past its due date is overdue", () => {
  const invoice = partiallyPaidPastDue();
  assert.equal(isInvoiceOverdue(invoice, invoice.balanceDue, NOW), true);

  const state = invoicePaymentState(invoice, NOW);
  assert.equal(state.status, "partially_paid");
  assert.equal(state.balanceDue, 750);
  assert.equal(state.isOverdue, true);
});

test("overdue keeps applying to sent and overdue statuses with a balance", () => {
  for (const status of ["sent", "overdue"]) {
    const invoice = partiallyPaidPastDue({ status, amountPaid: 0, balanceDue: 1000 });
    assert.equal(isInvoiceOverdue(invoice, invoice.balanceDue, NOW), true, status);
  }
});

test("isOverdue ignores draft, cancelled, paid, settled and future invoices", () => {
  const cases = [
    { status: "draft", balanceDue: 750 },
    { status: "cancelled", balanceDue: 750 },
    { status: "paid", balanceDue: 0 },
    { status: "partially_paid", balanceDue: 0 },
    { status: "partially_paid", dueDate: dayOffset(0) },
    { status: "partially_paid", dueDate: dayOffset(5) },
    { status: "partially_paid", dueDate: null },
  ];

  for (const overrides of cases) {
    const invoice = partiallyPaidPastDue(overrides);
    assert.equal(
      isInvoiceOverdue(invoice, invoice.balanceDue, NOW),
      false,
      JSON.stringify(overrides)
    );
  }
});

test("withEffectivePaymentFields exposes the derived isOverdue flag", () => {
  const invoice = partiallyPaidPastDue();
  const serialized = withEffectivePaymentFields(invoice, NOW);

  assert.equal(serialized.status, "partially_paid");
  assert.equal(serialized.isOverdue, true);
});

test("invoice statuses are rendered as human-readable labels", () => {
  assert.equal(invoiceStatusLabel("partially_paid"), "Partially Paid");
  assert.equal(invoiceStatusLabel("overdue"), "Overdue");
  assert.equal(invoiceStatusLabel("paid"), "Paid");
  assert.equal(invoiceStatusLabel(""), "Draft");
});
