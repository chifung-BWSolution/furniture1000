export function isMissingOtcStaffColumn(message: string | undefined): boolean {
  return /column\b[^\n]*\botc_staff_id\b[^\n]*does not exist/i.test(message ?? "");
}

/** Use the OTC identity when available; older PMS branches lack the column. */
export function reportProjectManagerFilterKey(staff?: {
  name?: string | null;
  position?: string | null;
  status?: string | null;
  otc_staff_id?: string | null;
}): string | null {
  if (staff?.position?.trim() !== "PM" || staff.status?.trim() !== "Active") return null;
  if (!Object.hasOwn(staff, "otc_staff_id")) {
    const name = staff.name?.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
    return name ? `pms-name:${name}` : null;
  }
  return staff.otc_staff_id?.trim() || null;
}
