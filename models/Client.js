import mongoose from "mongoose";

const clientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true }, // e.g. "Dr. Sekar V"
    company: { type: String, trim: true }, // e.g. "AVK Hospital"
    address: { type: String, trim: true }, // e.g. "Thondi, Ramanathapuram - 623403"
    email: { type: String, trim: true, lowercase: true },
    // Stored in E.164-ish format e.g. 91XXXXXXXXXX (no + , no spaces) for WhatsApp API use
    whatsapp: { type: String, trim: true },
    phone: { type: String, trim: true },
    gstn: { type: String, trim: true },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

export default mongoose.model("Client", clientSchema);
