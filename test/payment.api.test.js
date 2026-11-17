import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-only-secret-value-at-least-32-characters";
process.env.JWT_ISSUER = "flareminds-billing";
process.env.JWT_AUDIENCE = "flareminds-admin";
process.env.SMTP_HOST = "";
process.env.SMTP_USER = "";
process.env.SMTP_PASS = "";
process.env.SMTP_FROM = "";
process.env.WHATSAPP_PHONE_NUMBER_ID = "";
process.env.WHATSAPP_ACCESS_TOKEN = "";

const { default: Admin } = await import("../models/Admin.js");
const { default: Client } = await import("../models/Client.js");
const { default: Company } = await import("../models/Company.js");
const { default: Invoice } = await import("../models/Invoice.js");
const { default: Payment } = await import("../models/Payment.js");
const { signAccessToken } = await import("../utils/token.js");
const { closePdfBrowser } = await import("../services/pdfService.js");
const { app } = await import("../server.js");

let mongod;
let superToken;
let tokenA;
let tokenB;
let companyA;
let clientA;
let clientB;

const isoDay = (offset = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
};

const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function createInvoice({
  token = tokenA,
  client = clientA,
  total = 1000,
  status = "sent",
  dateOffset = 0,
  dueOffset = null,
} = {}) {
  const payload = {
    client,
    date: isoDay(dateOffset),
    taxPercent: 0,
    lineItems: [
      {
        description: "Payment test work",
        category: "other",
        quantity: 1,
        rate: total,
      },
    ],
  };
  if (dueOffset !== null) payload.dueDate = isoDay(dueOffset);

  const created = await request(app)
    .post("/api/invoices")
    .set(auth(token))
    .send(payload);
  assert.equal(created.status, 201, JSON.stringify(created.body));

  let invoice = created.body;
  if (status !== invoice.status) {
    const updated = await request(app)
      .put(`/api/invoices/${invoice._id}`)
      .set(auth(token))
      .send({ status });
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    invoice = updated.body;
  }
  return invoice;
}

const recordPayment = (token, invoiceId, body) =>
  request(app)
    .post(`/api/invoices/${invoiceId}/payments`)
    .set(auth(token))
    .send(body);

const getPayments = (token, invoiceId) =>
  request(app).get(`/api/invoices/${invoiceId}/payments`).set(auth(token));

const getInvoice = (token, invoiceId) =>
  request(app).get(`/api/invoices/${invoiceId}`).set(auth(token));

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all([
    Admin.syncIndexes(),
    Client.syncIndexes(),
    Company.syncIndexes(),
    Invoice.syncIndexes(),
    Payment.syncIndexes(),
  ]);

  const superadmin = await Admin.create({
    email: "payments-superadmin@platform.test",
    passwordHash: await Admin.hashPassword("SuperSecret@123"),
    name: "Payments SuperAdmin",
    role: "superadmin",
  });
  superToken = signAccessToken(superadmin);

  const provision = async (name, code, email, password) => {
    const res = await request(app)
      .post("/api/admin/companies")
      .set(auth(superToken))
      .send({
        name,
        code,
        invoicePrefix: `${code}-INV`,
        quotationPrefix: `${code}-QTN`,
        admin: { email, password, name: `${name} Admin` },
      });
    assert.equal(res.status, 201, JSON.stringify(res.body));

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email, password });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    return login.body.token;
  };

  tokenA = await provision(
    "Payments Alpha Corp",
    "PAYALPHA",
    "payments-alpha@test.local",
    "AlphaPassword@123"
  );
  tokenB = await provision(
    "Payments Beta Corp",
    "PAYBETA",
    "payments-beta@test.local",
    "BetaPassword@123"
  );

  const meA = await request(app).get("/api/companies/current").set(auth(tokenA));
  const meB = await request(app).get("/api/companies/current").set(auth(tokenB));
  assert.equal(meA.status, 200, JSON.stringify(meA.body));
  assert.equal(meB.status, 200, JSON.stringify(meB.body));

  clientA = (
    await Client.create({
      companyId: meA.body.company?._id || meA.body._id,
      name: "Payments Alpha Client",
      email: "alpha-client@test.local",
      phone: "1111111111",
    })
  )._id.toString();
  companyA = (meA.body.company?._id || meA.body._id).toString();
  clientB = (
    await Client.create({
      companyId: meB.body.company?._id || meB.body._id,
      name: "Payments Beta Client",
      email: "beta-client@test.local",
      phone: "2222222222",
    })
  )._id.toString();
});

after(async () => {
  await closePdfBrowser();
  await mongoose.disconnect();
  await mongod.stop();
});

test("payments are isolated by company for list, create and void", async () => {
  const invoice = await createInvoice();
  const created = await recordPayment(tokenA, invoice._id, {
    amount: 250,
    method: "upi",
    reference: "UPI-ALPHA-1",
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const wrongList = await getPayments(tokenB, invoice._id);
  assert.equal(wrongList.status, 404);

  const wrongCreate = await recordPayment(tokenB, invoice._id, {
    amount: 100,
    method: "cash",
  });
  assert.equal(wrongCreate.status, 404);

  const wrongVoid = await request(app)
    .post(`/api/invoices/${invoice._id}/payments/${created.body._id}/void`)
    .set(auth(tokenB))
    .send({ voidReason: "cross tenant" });
  assert.equal(wrongVoid.status, 404);

  const ownList = await getPayments(tokenA, invoice._id);
  assert.equal(ownList.status, 200);
  assert.equal(ownList.body.length, 1);
  assert.equal(ownList.body[0].amount, 250);
  assert.equal(await Payment.countDocuments({ invoiceId: invoice._id }), 1);
});

test("payment validation rejects zero, negative, overpayment and non-payable invoices", async () => {
  const invoice = await createInvoice({ total: 1000 });

  for (const amount of [0, -10, 1000.01]) {
    const res = await recordPayment(tokenA, invoice._id, { amount, method: "cash" });
    assert.equal(res.status, 400, `amount ${amount}: ${JSON.stringify(res.body)}`);
  }

  const badMethod = await recordPayment(tokenA, invoice._id, {
    amount: 10,
    method: "bitcoin",
  });
  assert.equal(badMethod.status, 400);

  const badDate = await recordPayment(tokenA, invoice._id, {
    amount: 10,
    method: "cash",
    paidOn: "not-a-date",
  });
  assert.equal(badDate.status, 400);

  const unchanged = await getInvoice(tokenA, invoice._id);
  assert.equal(unchanged.status, 200);
  assert.equal(unchanged.body.amountPaid, 0);
  assert.equal(unchanged.body.balanceDue, 1000);
  assert.equal(unchanged.body.status, "sent");
  assert.equal(await Payment.countDocuments({ invoiceId: invoice._id }), 0);

  const draft = await createInvoice({ status: "draft" });
  const draftPayment = await recordPayment(tokenA, draft._id, {
    amount: 10,
    method: "cash",
  });
  assert.equal(draftPayment.status, 409);

  const cancelled = await createInvoice({ status: "cancelled" });
  const cancelledPayment = await recordPayment(tokenA, cancelled._id, {
    amount: 10,
    method: "cash",
  });
  assert.equal(cancelledPayment.status, 409);
});

test("partial payment moves to partially_paid and the remainder to paid", async () => {
  const invoice = await createInvoice({ total: 1000 });

  const first = await recordPayment(tokenA, invoice._id, {
    amount: 400,
    method: "bank_transfer",
    reference: "NEFT-1001",
    notes: "First milestone",
    paidOn: isoDay(0),
  });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.amount, 400);
  assert.equal(first.body.invoice.amountPaid, 400);
  assert.equal(first.body.invoice.balanceDue, 600);
  assert.equal(first.body.invoice.status, "partially_paid");

  const partial = await getInvoice(tokenA, invoice._id);
  assert.equal(partial.status, 200);
  assert.equal(partial.body.amountPaid, 400);
  assert.equal(partial.body.balanceDue, 600);
  assert.equal(partial.body.status, "partially_paid");

  const partialList = await request(app)
    .get("/api/invoices?status=partially_paid")
    .set(auth(tokenA));
  assert.equal(partialList.status, 200);
  assert.ok(partialList.body.some((row) => row._id === invoice._id));

  const remaining = await recordPayment(tokenA, invoice._id, {
    amount: 600,
    method: "cash",
  });
  assert.equal(remaining.status, 201, JSON.stringify(remaining.body));
  assert.equal(remaining.body.invoice.amountPaid, 1000);
  assert.equal(remaining.body.invoice.balanceDue, 0);
  assert.equal(remaining.body.invoice.status, "paid");

  const paid = await getInvoice(tokenA, invoice._id);
  assert.equal(paid.status, 200);
  assert.equal(paid.body.amountPaid, 1000);
  assert.equal(paid.body.balanceDue, 0);
  assert.equal(paid.body.status, "paid");

  const extra = await recordPayment(tokenA, invoice._id, {
    amount: 1,
    method: "cash",
  });
  assert.equal(extra.status, 409);

  const payments = await getPayments(tokenA, invoice._id);
  assert.equal(payments.status, 200);
  assert.equal(payments.body.length, 2);
});

test("money is rounded to two decimals across multiple payments", async () => {
  const invoice = await createInvoice({ total: 1000 });

  const first = await recordPayment(tokenA, invoice._id, { amount: 0.1, method: "cash" });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const second = await recordPayment(tokenA, invoice._id, { amount: 0.2, method: "cash" });
  assert.equal(second.status, 201, JSON.stringify(second.body));

  const updated = await getInvoice(tokenA, invoice._id);
  assert.equal(updated.status, 200);
  assert.equal(updated.body.amountPaid, 0.3);
  assert.equal(updated.body.balanceDue, 999.7);
  assert.equal(updated.body.status, "partially_paid");
});

test("voiding a payment keeps the record and reverts invoice status", async () => {
  const invoice = await createInvoice({ total: 1000 });

  const partial = await recordPayment(tokenA, invoice._id, {
    amount: 400,
    method: "upi",
  });
  assert.equal(partial.status, 201, JSON.stringify(partial.body));

  const voided = await request(app)
    .post(`/api/invoices/${invoice._id}/payments/${partial.body._id}/void`)
    .set(auth(tokenA))
    .send({ voidReason: "Duplicate entry" });
  assert.equal(voided.status, 200, JSON.stringify(voided.body));
  assert.equal(voided.body.voided, true);
  assert.equal(voided.body.voidReason, "Duplicate entry");
  assert.equal(voided.body.invoice.amountPaid, 0);
  assert.equal(voided.body.invoice.balanceDue, 1000);
  assert.equal(voided.body.invoice.status, "sent");

  const again = await request(app)
    .post(`/api/invoices/${invoice._id}/payments/${partial.body._id}/void`)
    .set(auth(tokenA))
    .send({ voidReason: "Second attempt" });
  assert.equal(again.status, 409);

  const history = await getPayments(tokenA, invoice._id);
  assert.equal(history.status, 200);
  assert.equal(history.body.length, 1);
  assert.equal(history.body[0].voided, true);
  assert.equal(await Payment.countDocuments({ invoiceId: invoice._id }), 1);

  const full = await recordPayment(tokenA, invoice._id, {
    amount: 1000,
    method: "cheque",
  });
  assert.equal(full.status, 201, JSON.stringify(full.body));
  assert.equal(full.body.invoice.status, "paid");

  const voidFull = await request(app)
    .post(`/api/invoices/${invoice._id}/payments/${full.body._id}/void`)
    .set(auth(tokenA))
    .send({ voidReason: "Cheque bounced" });
  assert.equal(voidFull.status, 200, JSON.stringify(voidFull.body));
  assert.equal(voidFull.body.invoice.status, "sent");
  assert.equal(voidFull.body.invoice.amountPaid, 0);
  assert.equal(voidFull.body.invoice.balanceDue, 1000);
});

test("overdue is computed from dueDate and a void reverts to overdue when still unpaid", async () => {
  const invoice = await createInvoice({
    total: 1000,
    dateOffset: -40,
    dueOffset: -10,
  });

  const beforePayment = await getInvoice(tokenA, invoice._id);
  assert.equal(beforePayment.status, 200);
  assert.equal(beforePayment.body.status, "overdue");
  assert.equal(beforePayment.body.balanceDue, 1000);

  const overdueList = await request(app)
    .get("/api/invoices?status=overdue")
    .set(auth(tokenA));
  assert.equal(overdueList.status, 200);
  assert.ok(overdueList.body.some((row) => row._id === invoice._id));

  const full = await recordPayment(tokenA, invoice._id, {
    amount: 1000,
    method: "cash",
  });
  assert.equal(full.status, 201, JSON.stringify(full.body));
  assert.equal(full.body.invoice.status, "paid");

  const voided = await request(app)
    .post(`/api/invoices/${invoice._id}/payments/${full.body._id}/void`)
    .set(auth(tokenA))
    .send({ voidReason: "Refund issued" });
  assert.equal(voided.status, 200, JSON.stringify(voided.body));
  assert.equal(voided.body.invoice.status, "overdue");
  assert.equal(voided.body.invoice.amountPaid, 0);
  assert.equal(voided.body.invoice.balanceDue, 1000);
});

test("concurrent payments cannot exceed the invoice total", async () => {
  const invoice = await createInvoice({ total: 1000 });

  const results = await Promise.all([
    recordPayment(tokenA, invoice._id, { amount: 600, method: "cash" }),
    recordPayment(tokenA, invoice._id, { amount: 600, method: "upi" }),
  ]);
  const statuses = results.map((res) => res.status).sort();
  assert.deepEqual(statuses, [201, 400], JSON.stringify(results.map((r) => r.body)));

  const afterTwo = await getInvoice(tokenA, invoice._id);
  assert.equal(afterTwo.status, 200);
  assert.equal(afterTwo.body.amountPaid, 600);
  assert.equal(afterTwo.body.balanceDue, 400);
  assert.equal(afterTwo.body.status, "partially_paid");

  const multi = await createInvoice({ total: 1000 });
  const many = await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      recordPayment(tokenA, multi._id, {
        amount: 300,
        method: "cash",
        reference: `CONCURRENT-${index}`,
      })
    )
  );
  const successes = many.filter((res) => res.status === 201);
  const failures = many.filter((res) => res.status !== 201);
  assert.equal(successes.length, 3, JSON.stringify(many.map((r) => r.body)));
  assert.equal(failures.length, 2);
  assert.ok(failures.every((res) => res.status === 400 || res.status === 409));

  const stored = await Invoice.findById(multi._id).lean();
  const payments = await Payment.find({ invoiceId: multi._id, voided: false }).lean();
  const totalPaid = payments.reduce((sum, payment) => sum + payment.amount, 0);
  assert.ok(totalPaid <= 1000);
  assert.equal(totalPaid, 900);
  assert.equal(stored.amountPaid, 900);
  assert.equal(stored.balanceDue, 100);
  assert.equal(stored.status, "partially_paid");
});

test("legacy paid invoices without stored payment fields stay fully paid", async () => {
  // Insert straight into the collection so Mongoose defaults are not applied:
  // this is exactly how rows created before the Payment model look on disk.
  const legacyId = new mongoose.Types.ObjectId();
  await Invoice.collection.insertOne({
    _id: legacyId,
    invoiceNumber: "PAYALPHA-INV-LEGACY-0001",
    companyId: new mongoose.Types.ObjectId(companyA),
    client: new mongoose.Types.ObjectId(clientA),
    date: new Date("2025-01-01T00:00:00.000Z"),
    dueDate: new Date("2025-01-15T00:00:00.000Z"),
    lineItems: [
      {
        description: "Legacy paid work",
        category: "other",
        quantity: 1,
        rate: 500,
        amount: 500,
        customFields: {},
      },
    ],
    subTotal: 500,
    taxPercent: 0,
    taxAmount: 0,
    grandTotal: 500,
    status: "paid",
    notes: "",
    customFields: {},
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    updatedAt: new Date("2025-01-01T00:00:00.000Z"),
  });

  const detail = await getInvoice(tokenA, legacyId.toString());
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  assert.equal(detail.body.amountPaid, 500);
  assert.equal(detail.body.balanceDue, 0);
  assert.equal(detail.body.status, "paid");

  const list = await request(app).get("/api/invoices").set(auth(tokenA));
  assert.equal(list.status, 200);
  const row = list.body.find((inv) => inv._id === legacyId.toString());
  assert.ok(row, "legacy invoice missing from list");
  assert.equal(row.amountPaid, 500);
  assert.equal(row.balanceDue, 0);
  assert.equal(row.status, "paid");
});
