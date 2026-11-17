export function isCompanyActive(company) {
  if (!company) return false;
  if (company.status !== undefined && company.status !== null) {
    return company.status === "active";
  }
  return company.isActive !== false;
}

export function suspendedResponse(res, company) {
  return res.status(403).json({
    code: "COMPANY_SUSPENDED",
    message:
      company?.suspendedReason
        ? `This company is suspended: ${company.suspendedReason}`
        : "This company is suspended. Contact the platform administrator.",
  });
}
