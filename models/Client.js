import mongoose from "mongoose";

const clientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    company: { type: String, trim: true }, // Client organization name (e.g. "AVK Hospital")
    address: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    whatsapp: { type: String, trim: true },
    phone: { type: String, trim: true },
    gstn: { type: String, trim: true },
    notes: { type: String, trim: true },

    // Hosting company / tenant reference for multi-company isolation
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      index: true,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

clientSchema.index({ companyId: 1, createdAt: -1 });

export default mongoose.models.Client || mongoose.model("Client", clientSchema);
