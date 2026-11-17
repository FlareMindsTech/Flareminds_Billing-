import Admin from "../models/Admin.js";

// Runs on server startup. Lets you manage login via .env instead of building
// a signup flow - change ADMIN_EMAIL/ADMIN_PASSWORD and restart to rotate credentials
// (only takes effect for a *new* admin doc; see note below).
export async function seedAdminFromEnv() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.warn("ADMIN_EMAIL / ADMIN_PASSWORD not set - skipping admin seed. Login will fail until set.");
    return;
  }

  const syncPassword = process.env.ADMIN_SYNC_PASSWORD === "true";
  const existing = await Admin.findOne({ email: email.toLowerCase() });

  if (existing) {
    // The env-configured account is always the platform superadmin.
    let changed = false;
    if (existing.role !== "superadmin") {
      existing.role = "superadmin";
      existing.companyId = null;
      changed = true;
    }

    // Only rewrite the password when explicitly opted in, so a normal restart
    // never resets credentials that were changed after seeding.
    if (syncPassword) {
      existing.passwordHash = await Admin.hashPassword(password);
      changed = true;
      console.log(`Updated password for admin ${email}`);
    }

    if (changed) {
      await existing.save();
      console.log(`Ensured superadmin role for ${email}`);
    }
    return;
  }

  const passwordHash = await Admin.hashPassword(password);
  await Admin.create({
    email: email.toLowerCase(),
    passwordHash,
    name: "Super Admin",
    role: "superadmin",
    companyId: null,
  });
  console.log(`Seeded superadmin account for ${email}`);
}
