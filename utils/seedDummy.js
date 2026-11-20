import "dotenv/config";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to run seedDummy.js in production.");
  process.exit(1);
}

import { connectDB } from "../config/db.js";
import Admin from "../models/Admin.js";
import Client from "../models/Client.js";
import Invoice from "../models/Invoice.js";
import Counter from "../models/Counter.js";
import mongoose from "mongoose";

const ADMIN_EMAIL = "admin@gmail.com";
const ADMIN_PASSWORD = "Admin@123";

const clients = [
  {
    name: "Dr. Sekar V",
    company: "AVK Hospital",
    address: "Thondi, Ramanathapuram - 623403",
    email: "sekar@avkhospital.in",
    whatsapp: "919500950813",
    phone: "+91 95009 50813",
    gstn: "33ABCDE1234F1Z5",
    notes: "Prefers WhatsApp for invoice delivery.",
  },
  {
    name: "Priya Raman",
    company: "Bloom Interiors",
    address: "44 Race Course Road, Coimbatore - 641018",
    email: "priya@bloominteriors.in",
    whatsapp: "919876543210",
    phone: "+91 98765 43210",
    gstn: "33XYZAB6789G1Z2",
    notes: "Retainer client - monthly social media.",
  },
  {
    name: "Arjun Kumar",
    company: "Nexa Tech Solutions",
    address: "12 OMR, Chennai - 600096",
    email: "arjun@nexatech.io",
    whatsapp: "919812345678",
    phone: "+91 98123 45678",
    gstn: "33LMNOP4321H1Z9",
    notes: "Invoices require PO number in description.",
  },
];

const invoiceSeeds = [
  {
    clientIndex: 0,
    status: "paid",
    taxPercent: 18,
    daysAgo: 40,
    dueInDays: 15,
    notes: "Website maintenance and campaign management for Q3.",
    lineItems: [
      {
        description: "Digital marketing - social media management",
        category: "digital-marketing",
        quantity: 1,
        rate: 25000,
      },
      {
        description: "Website maintenance and hosting",
        category: "development",
        quantity: 1,
        rate: 12000,
      },
    ],
  },
  {
    clientIndex: 1,
    status: "sent",
    taxPercent: 18,
    daysAgo: 10,
    dueInDays: 15,
    notes: "Monthly retainer for October.",
    lineItems: [
      {
        description: "Social media content and ad management",
        category: "digital-marketing",
        quantity: 1,
        rate: 35000,
      },
      {
        description: "Landing page design",
        category: "development",
        quantity: 2,
        rate: 9000,
      },
    ],
  },
  {
    clientIndex: 2,
    status: "overdue",
    taxPercent: 18,
    daysAgo: 35,
    dueInDays: 15,
    notes: "E-commerce portal development - milestone 2.",
    lineItems: [
      {
        description: "E-commerce portal development - milestone 2",
        category: "development",
        quantity: 1,
        rate: 75000,
      },
      {
        description: "SEO audit and keyword strategy",
        category: "digital-marketing",
        quantity: 1,
        rate: 15000,
      },
    ],
  },
  {
    clientIndex: 2,
    status: "draft",
    taxPercent: 18,
    daysAgo: 1,
    dueInDays: 15,
    notes: "Draft invoice - awaiting PO number from client.",
    lineItems: [
      {
        description: "Brand identity design",
        category: "other",
        quantity: 1,
        rate: 40000,
      },
    ],
  },
];

function computeTotals(lineItems, taxPercent = 0) {
  const items = lineItems.map((item) => ({
    ...item,
    amount: Number(item.quantity || 1) * Number(item.rate),
  }));
  const subTotal = items.reduce((sum, item) => sum + item.amount, 0);
  const taxAmount = (subTotal * Number(taxPercent || 0)) / 100;
  const grandTotal = subTotal + taxAmount;
  return { items, subTotal, taxAmount, grandTotal };
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

async function seedAdmin() {
  const passwordHash = await Admin.hashPassword(ADMIN_PASSWORD);
  const admin = await Admin.findOneAndUpdate(
    { email: ADMIN_EMAIL },
    { email: ADMIN_EMAIL, passwordHash, name: "Admin" },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  console.log(`Admin ready: ${admin.email} / ${ADMIN_PASSWORD}`);
}

async function seedClients() {
  const docs = [];
  for (const data of clients) {
    const doc = await Client.findOneAndUpdate(
      { email: data.email },
      data,
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    docs.push(doc);
  }
  console.log(`Clients ready: ${docs.length}`);
  return docs;
}

async function seedInvoices(clientDocs) {
  const existing = await Invoice.countDocuments();
  if (existing > 0) {
    console.log(`Invoices already present (${existing}), skipping invoice seed.`);
    return;
  }

  const year = new Date().getFullYear();
  const counterKey = `invoiceNumber_${year}`;
  const counter = await Counter.findByIdAndUpdate(
    counterKey,
    { $inc: { sequence: invoiceSeeds.length } },
    { new: true, upsert: true }
  );
  const startSequence = counter.sequence - invoiceSeeds.length + 1;

  let index = 0;
  for (const seed of invoiceSeeds) {
    const { items, subTotal, taxAmount, grandTotal } = computeTotals(
      seed.lineItems,
      seed.taxPercent
    );

    const date = addDays(new Date(), -seed.daysAgo);
    const dueDate = addDays(date, seed.dueInDays);
    const invoiceNumber = `FM-${year}-${String(startSequence + index).padStart(4, "0")}`;

    const sentLog =
      seed.status === "draft"
        ? []
        : [
            {
              channel: "email",
              to: clientDocs[seed.clientIndex].email,
              sentAt: date,
              success: true,
            },
          ];

    await Invoice.create({
      invoiceNumber,
      client: clientDocs[seed.clientIndex]._id,
      date,
      dueDate,
      lineItems: items,
      subTotal,
      taxPercent: seed.taxPercent,
      taxAmount,
      grandTotal,
      notes: seed.notes,
      status: seed.status,
      sentLog,
    });

    console.log(`Invoice ${invoiceNumber} created (${seed.status}) - total ₹${grandTotal}`);
    index += 1;
  }
}

async function main() {
  try {
    await connectDB();
    await seedAdmin();
    const clientDocs = await seedClients();
    await seedInvoices(clientDocs);
    console.log("\nDummy data seeded successfully.");
  } catch (err) {
    console.error("Seed failed:", err.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
