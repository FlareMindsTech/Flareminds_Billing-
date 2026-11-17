import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-only-secret-value-at-least-32-characters";
process.env.SMTP_HOST = "";
process.env.WHATSAPP_PHONE_NUMBER_ID = "";
process.env.WHATSAPP_ACCESS_TOKEN = "";

const { default: Admin } = await import("../models/Admin.js");
const { default: Client } = await import("../models/Client.js");
const { default: Company } = await import("../models/Company.js");
const { default: Quotation } = await import("../models/Quotation.js");
const { default: Invoice } = await import("../models/Invoice.js");
const { signAccessToken } = await import("../utils/token.js");
const { ensureDefaultTemplates } = await import("../services/templateService.js");
const { app } = await import("../server.js");

let replSet;
let auth;
let client;

const isoDay = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, name: "rs0" } });
  await mongoose.connect(replSet.getUri());
  await Promise.all([
    Admin.syncIndexes(),
    Client.syncIndexes(),
    Company.syncIndexes(),
    Quotation.syncIndexes(),
    Invoice.syncIndexes(),
  ]);

  const company = await Company.create({
    name: "Txn Billing Co",
    code: "TXN",
    invoicePrefix: "TXN",
    quotationPrefix: "TXN-QTN",
  });
  await ensureDefaultTemplates(company._id);

  const admin = await Admin.create({
    email: "txn-admin@example.com",
    passwordHash: "not-used",
    name: "Txn Admin",
    role: "company_admin",
    companyId: company._id,
  });
  auth = signAccessToken(admin);
  client = await Client.create({
    companyId: company._id,
    name: "Txn Client",
    email: "txn@client.test",
  });
});

after(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});

const createAndAccept = async () => {
  const created = await request(app)
    .post("/api/quotations")
    .set("Authorization", `Bearer ${auth}`)
    .send({
      client: client._id,
      issueDate: isoDay(0),
      validUntil: isoDay(30),
      lineItems: [
        {
          description: "Transaction conversion item",
          category: "service",
          unit: "project",
          quantity: 1,
          unitPrice: 25000,
          taxPercent: 18,
        },
      ],
    });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const accepted = await request(app)
    .post(`/api/quotations/${created.body._id}/accept`)
    .set("Authorization", `Bearer ${auth}`);
  assert.equal(accepted.status, 200);
  return created.body;
};

test("conversion uses a transaction on a replica set and remains idempotent", async () => {
  const quotation = await createAndAccept();

  const convert = () =>
    request(app)
      .post(`/api/quotations/${quotation._id}/convert-to-invoice`)
      .set("Authorization", `Bearer ${auth}`);

  const responses = await Promise.all([convert(), convert(), convert()]);
  for (const res of responses) {
    assert.ok([200, 201, 409].includes(res.status), `unexpected ${res.status}: ${JSON.stringify(res.body)}`);
  }
  assert.ok(responses.some((res) => [200, 201].includes(res.status)));

  const invoices = await Invoice.find({ sourceQuotation: quotation._id });
  assert.equal(invoices.length, 1);

  const stored = await Quotation.findById(quotation._id);
  assert.equal(stored.status, "converted");
  assert.equal(String(stored.convertedInvoice), String(invoices[0]._id));

  const retry = await convert();
  assert.equal(retry.status, 200);
  assert.equal(retry.body.invoice._id, String(invoices[0]._id));
});
