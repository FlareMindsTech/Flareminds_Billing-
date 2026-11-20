export function requireSuperadmin(req, res, next) {
  if (req.admin?.role !== "superadmin") {
    return res.status(403).json({ message: "Superadmin access required" });
  }
  return next();
}

export function requireCompanyAdmin(req, res, next) {
  // Company settings are editable by the owning company admin and by a
  // Super Admin acting on an explicitly selected company. Super Admins are
  // never granted an implicit company here; resolveCompany enforces that.
  if (req.admin?.role === "superadmin") {
    return next();
  }
  if (req.admin?.role !== "company_admin" || !req.admin?.companyId) {
    return res.status(403).json({ message: "Company administrator access required" });
  }
  return next();
}
