export function requireSuperadmin(req, res, next) {
  if (req.admin?.role !== "superadmin") {
    return res.status(403).json({ message: "Superadmin access required" });
  }
  return next();
}

export function requireCompanyAdmin(req, res, next) {
  if (!req.admin?.companyId || req.admin.role === "superadmin") {
    return res.status(403).json({ message: "Company administrator access required" });
  }
  return next();
}
