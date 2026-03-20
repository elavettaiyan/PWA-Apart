export function buildResidentBillFilter(flatIds: string[]) {
  return { flatId: { in: flatIds } };
}

export function canResidentAccessBill(billFlatId: string, residentFlatIds: string[]) {
  return residentFlatIds.includes(billFlatId);
}
