import { multiCoreReportSections } from "./multiCoreReports.js";
import { reportCsv } from "./cableSchedule.js";

/** Shared read-only report tables for the editor and embedded technician viewer. */
export function renderMultiCoreReports(host, reports, { download } = {}) {
  host.replaceChildren();
  const text = (tag, value) => { const el = document.createElement(tag); el.textContent = String(value ?? ""); return el; };
  for (const [title, columns, rows] of multiCoreReportSections(reports)) {
    const section = document.createElement("details"); section.className = "multi-core-report-section";
    section.append(text("summary", `${title} (${rows.length})`));
    if (download) {
      const button = text("button", "Download CSV"); button.type = "button"; button.className = "tool-button";
      button.addEventListener("click", () => download(reportCsv(columns, rows), title)); section.append(button);
    }
    const wrap = document.createElement("div"); wrap.className = "output-report-table cable-schedule-table-wrap";
    const table = document.createElement("table"); table.className = "cable-schedule-table";
    const head = document.createElement("thead"), header = document.createElement("tr");
    columns.forEach(([, label]) => header.append(text("th", label))); head.append(header); table.append(head);
    const body = document.createElement("tbody");
    for (const row of rows) { const tr = document.createElement("tr"); columns.forEach(([key]) => tr.append(text("td", row[key]))); body.append(tr); }
    table.append(body); wrap.append(table); section.append(wrap); host.append(section);
  }
}
