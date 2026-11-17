// Structured, append-only security audit trail.
// Callers must only pass non-secret fields (never passwords, tokens or full request bodies).
export function audit(event, details = {}) {
  const record = {
    type: "audit",
    event,
    at: new Date().toISOString(),
    ...details,
  };

  try {
    console.info(JSON.stringify(record));
  } catch {
    console.info(`[audit] ${event}`);
  }
}
