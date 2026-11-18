// Collection totals for the dashboard. Kept free of model imports so the
// month bucketing and legacy-invoice rules can be unit tested in isolation.
import { invoicePaymentState, roundMoney } from "./invoicePayments.js";

export const REVENUE_TREND_MONTHS = 6;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const pad2 = (value) => String(value).padStart(2, "0");

export function monthKey(date) {
  const parsed = new Date(date);
  return `${parsed.getUTCFullYear()}-${pad2(parsed.getUTCMonth() + 1)}`;
}

// Zero-filled buckets for the last `count` months, oldest first. Months are
// bucketed in UTC so a payment is never counted twice (or skipped) because of
// the server's local timezone.
export function buildMonthBuckets(now = new Date(), count = REVENUE_TREND_MONTHS) {
  const base = new Date(now);
  const buckets = [];

  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const start = new Date(
      Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - offset, 1)
    );
    const end = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)
    );
    const monthName = MONTH_NAMES[start.getUTCMonth()];

    buckets.push({
      month: `${start.getUTCFullYear()}-${pad2(start.getUTCMonth() + 1)}`,
      label: monthName.slice(0, 3),
      fullLabel: `${monthName} ${start.getUTCFullYear()}`,
      total: 0,
      start,
      end,
    });
  }

  return buckets;
}

export function trendRange(now = new Date(), count = REVENUE_TREND_MONTHS) {
  const buckets = buildMonthBuckets(now, count);
  return {
    from: buckets[0].start,
    to: buckets[buckets.length - 1].end,
  };
}

// Legacy paid invoices predate the Payment model, so they only have a status
// and totals. Prefer an explicitly stored paid date, then fall back to the last
// update (the write that marked them paid).
export function legacyPaidDate(invoice) {
  const candidates = [
    invoice?.paidAt,
    invoice?.paidOn,
    invoice?.updatedAt,
    invoice?.createdAt,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) return date;
  }

  return null;
}

// Sums non-voided payments plus legacy paid invoices that have no Payment
// records. Only the last `monthCount` months are bucketed, but `collected`
// covers all time so the KPI matches the full invoice history.
export function summarizeCollections({
  payments = [],
  legacyInvoices = [],
  now = new Date(),
  monthCount = REVENUE_TREND_MONTHS,
} = {}) {
  const buckets = buildMonthBuckets(now, monthCount);
  const byMonth = new Map(buckets.map((bucket) => [bucket.month, bucket]));
  let collected = 0;

  const add = (amount, date) => {
    const value = roundMoney(amount);
    if (value <= 0) return;

    collected = roundMoney(collected + value);

    if (!date) return;
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) return;

    const bucket = byMonth.get(monthKey(parsed));
    if (bucket) bucket.total = roundMoney(bucket.total + value);
  };

  for (const payment of payments) {
    if (payment?.voided) continue;
    add(payment?.amount, payment?.paidOn || payment?.createdAt);
  }

  for (const invoice of legacyInvoices) {
    const state = invoicePaymentState(invoice, now);
    add(state.amountPaid, legacyPaidDate(invoice));
  }

  return {
    collected,
    months: buckets.map(({ month, label, fullLabel, total }) => ({
      month,
      label,
      fullLabel,
      total,
    })),
  };
}
