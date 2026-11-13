const list = value => Array.isArray(value) ? value : [];

export const MULTI_CORE_ASSEMBLY_COLUMNS = Object.freeze([
  ["assemblyId", "Assembly ID"], ["name", "Multi-Core Name"], ["manufacturer", "Manufacturer"], ["model", "Model"],
  ["endAStyle", "End A Style"], ["endBStyle", "End B Style"], ["length", "Trunk Length"], ["lengthUnit", "Length Unit"],
  ["circuitCount", "Circuit Count"], ["occupied", "Occupied Channels"], ["spare", "Spare Channels"], ["disabled", "Disabled Channels"],
  ["reserved", "Reserved Channels"], ["unresolved", "Unresolved Channels"], ["location", "Location"], ["notes", "Notes"]
]);
export const MULTI_CORE_CHANNEL_COLUMNS = Object.freeze([
  ["assemblyId", "Assembly ID"], ["channel", "Channel Number"], ["circuitId", "Stable Circuit Reference"],
  ["mediaFamily", "Media Family"], ["mediaSpec", "Media Specification"], ["endAPort", "End A Port"], ["endBPort", "End B Port"],
  ["endAConnection", "End A Connection"], ["endBConnection", "End B Connection"], ["endACableId", "End A Cable ID"],
  ["endBCableId", "End B Cable ID"], ["status", "Channel Status"], ["reservation", "Reservation"], ["notes", "Notes"], ["strands", "Strands"]
]);
export const MULTI_CORE_DIAGNOSTIC_COLUMNS = Object.freeze([
  ["severity", "Severity"], ["code", "Code"], ["multiCoreId", "Assembly ID"], ["circuitId", "Circuit Reference"],
  ["wireId", "Cable Reference"], ["message", "Message"], ["referenceText", "Unresolved Reference"]
]);

export function multiCoreReportSections(reports, { includeBreakoutSchedule = false } = {}) {
  return [["Multi-Core Assembly Register", MULTI_CORE_ASSEMBLY_COLUMNS, reports?.assemblies || []],
    ["QSFP Breakout Cable Schedule", [["cableNumber", "Assembly ID"], ["cable", "Cable"], ["breakoutMode", "Mode"],
      ["sourceDevice", "Source Device"], ["sourcePort", "Source Port"], ["length", "Physical Length"],
      ["breakoutDetails", "Channels"]], includeBreakoutSchedule ? list(reports?.cableRows).filter(row => row.breakoutAssemblyId) : []],
    ["Channel Allocation Manifest", MULTI_CORE_CHANNEL_COLUMNS, reports?.channels || []],
    ["Diagnostics", MULTI_CORE_DIAGNOSTIC_COLUMNS, reports?.diagnostics || []]].filter(([, , rows]) => rows.length);
}
