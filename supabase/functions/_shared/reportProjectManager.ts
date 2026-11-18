/** Use the PMS PM classification and the linked OTC staff identity. */
export function reportProjectManagerOtcId(staff?: {
  position?: string | null;
  status?: string | null;
  otc_staff_id?: string | null;
}): string | null {
  if (staff?.position?.trim() !== "PM" || staff.status?.trim() !== "Active") return null;
  return staff.otc_staff_id?.trim() || null;
}
