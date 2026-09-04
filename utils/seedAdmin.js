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

  const existing = await Admin.findOne({ email: email.toLowerCase() });
  if (existing) return; // already seeded - edit the DB directly (or drop the doc) to rotate the password

  const passwordHash = await Admin.hashPassword(password);
  await Admin.create({ email: email.toLowerCase(), passwordHash, name: "Admin" });
  console.log(`Seeded admin account for ${email}`);
}
