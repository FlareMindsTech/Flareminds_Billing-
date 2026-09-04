import mongoose from "mongoose";

const lineItemSchema = new mongoose.Schema(
  {
    description: { type: String, required: true },
    // Tags the line item to a side of the business - lets one invoice mix both,
    // or a whole invoice can be single-category by using the same tag on every row.
    category: {
      type: String,
      enum: ["digital-marketing", "development", "other"],
      default: "other",
    },
    quantity: { type: Number, default: 1 },
    rate: { type: Number, required: true },
    amount: { type: Number, required: true }, // quantity * rate, kept explicit for easy editing
  },
  { _id: false }
);

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true }, // e.g. FM-2026-0001
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true },
    date: { type: Date, required: true, default: Date.now },
    dueDate: { type: Date },

    lineItems: { type: [lineItemSchema], required: true, validate: (v) => v.length > 0 },

    subTotal: { type: Number, required: true },
    taxPercent: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    grandTotal: { type: Number, required: true },

    notes: {
      type: String,
      default:
        "Your success is our mission. Thank you for choosing us for your marketing and software development needs — we're proud to be part of your journey.",
    },

    status: {
      type: String,
      enum: ["draft", "sent", "paid", "overdue", "cancelled"],
      default: "draft",
    },

    // Log of delivery attempts so the admin can see what's been sent and when
    sentLog: [
      {
        channel: { type: String, enum: ["email", "whatsapp"] },
        to: String,
        sentAt: { type: Date, default: Date.now },
        success: Boolean,
        error: String,
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.model("Invoice", invoiceSchema);
