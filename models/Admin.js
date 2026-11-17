import mongoose from "mongoose";
import bcrypt from "bcryptjs";

export const ADMIN_ROLES = ["superadmin", "company_admin"];

const adminSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, trim: true, default: "Admin" },
    role: {
      type: String,
      enum: ADMIN_ROLES,
      default: "company_admin",
      index: true,
    },
    // Company admins are locked to exactly one company. Superadmins have no company.
    companyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      default: null,
      index: true,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
    lastLoginAt: { type: Date, default: null },
    // Setting this to false immediately revokes access for existing tokens.
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

adminSchema.methods.isSuperadmin = function () {
  return this.role === "superadmin";
};

adminSchema.methods.comparePassword = function (plainPassword) {
  return bcrypt.compare(plainPassword, this.passwordHash);
};

adminSchema.statics.hashPassword = function (plainPassword) {
  return bcrypt.hash(plainPassword, 10);
};

export default mongoose.model("Admin", adminSchema);
