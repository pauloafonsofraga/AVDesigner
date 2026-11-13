import { cableScheduleColumns, CABLE_SCHEDULE_FILTER_KEYS, cableScheduleFilterOptions,
  cableScheduleVisibleRowIndexes, reportCsv } from "./cableScheduleCore.js";

/** Read-only schedule over the same physical cable rows embedded for reports. */
export function installOutputCableSchedule(viewer, rows = []) {
  const host = viewer.host, signal = viewer.abort.signal;
  const text = (tag, value) => { const el = document.createElement(tag); el.textContent = String(value ?? ""); return el; };
  const button = document.createElement("button"); button.append(text("span", "Cable Schedule")); button.type = "button"; button.dataset.action = "cable-schedule";
  button.setAttribute("aria-label", "Cable Schedule");
  button.title = "Cable Schedule";
  // Lucide table-properties, matching the editor toolbar's licensed icon subset.
  const ns = "http://www.w3.org/2000/svg", icon = document.createElementNS(ns, "svg");
  for (const [key, value] of Object.entries({viewBox:"0 0 24 24",width:18,height:18,fill:"none",stroke:"currentColor","stroke-width":2,"stroke-linecap":"round","stroke-linejoin":"round","aria-hidden":"true"})) icon.setAttribute(key, value);
  for (const [tag, attrs] of [["path",{d:"M15 3v18"}],["rect",{width:18,height:18,x:3,y:3,rx:2}],["path",{d:"M21 9H3"}],["path",{d:"M21 15H3"}]]) {
    const el = document.createElementNS(ns, tag); for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value); icon.append(el);
  }
  button.prepend(icon); host.querySelector('[role="toolbar"]').prepend(button);
  const dialog = document.createElement("dialog"); dialog.className = "output-report output-cable-schedule"; dialog.setAttribute("aria-label", "Cable Schedule");
  const header = document.createElement("header"), title = text("h2", "Cable Schedule"), close = text("button", "Close"); close.type = "button";
  header.append(title, close); dialog.append(header);
  const body = document.createElement("div"); body.className = "output-report-body";
  const wrap = document.createElement("div"); wrap.className = "output-report-table"; wrap.tabIndex = 0; wrap.setAttribute("aria-label", "Cable schedule table");
  const table = document.createElement("table"), head = document.createElement("thead"), heading = document.createElement("tr"), tbody = document.createElement("tbody");
  const columns = cableScheduleColumns(rows), filters = {};
  for (const [key, label] of columns) {
    const th = text("th", label); th.scope = "col";
    if (CABLE_SCHEDULE_FILTER_KEYS.includes(key)) {
      const select = document.createElement("select"); select.setAttribute("aria-label", `Filter ${label}`);
      const all = text("option", "All"); all.value = ""; select.append(all);
      for (const value of cableScheduleFilterOptions(rows, key)) { const option = text("option", value); option.value = value; select.append(option); }
      select.addEventListener("change", () => { filters[key] = select.value; render(); }, {signal}); th.append(select);
    }
    heading.append(th);
  }
  head.append(heading); table.append(head, tbody); wrap.append(table);
  const empty = text("p", "No cables in this project."), footer = document.createElement("footer"), count = text("span", ""), download = text("button", "Export CSV");
  count.setAttribute("role", "status"); download.type = "button"; footer.append(count, download);
  body.append(wrap, empty); dialog.append(body, footer); host.append(dialog);
  const visible = () => cableScheduleVisibleRowIndexes(rows, filters).map(index => rows[index]);
  function render() {
    const selected = visible(); tbody.replaceChildren();
    for (const row of selected) {
      const tr = document.createElement("tr");
      for (const [key] of columns) {
        const td = text("td", row[key]);
        if (key === "cableNumber") {
          const ids = (row.wireIds || []).filter(id => viewer.scene.getWire(id));
          if (ids.length || row.breakoutAssemblyId) {
            const link = text("button", row[key] || "Cable"); link.type = "button";
            link.title = row.breakoutAssemblyId ? "Inspect breakout assembly" : "View cable signal chain";
            if (row.breakoutAssemblyId) link.dataset.scheduleBreakoutId = row.breakoutAssemblyId;
            else link.dataset.scheduleWireId = ids[0];
            td.replaceChildren(link);
          }
        }
        tr.append(td);
      }
      tbody.append(tr);
    }
    empty.hidden = selected.length > 0; empty.textContent = rows.length ? "No cables match these filters." : "No cables in this project.";
    count.textContent = `${selected.length} of ${rows.length} cables`; download.disabled = selected.length === 0;
  }
  tbody.addEventListener("click", event => {
    const assembly = event.target.closest("button[data-schedule-breakout-id]")?.dataset.scheduleBreakoutId;
    if (assembly) { dialog.close(); viewer.select({ type: "qsfp-breakout", id: assembly }); return; }
    const link = event.target.closest("button[data-schedule-wire-id]"); if (!link) return;
    dialog.close(); viewer.select({type:"wire",id:link.dataset.scheduleWireId}); viewer.openSignalChain();
  }, {signal});
  download.addEventListener("click", () => {
    const blob = new Blob(["\uFEFF", reportCsv(columns, visible())], {type:"text/csv;charset=utf-8"}), url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = `${String(viewer.options.title || "WireNexus").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0,80) || "WireNexus"}-cable-schedule.csv`;
    host.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, {signal});
  button.addEventListener("click", () => { render(); dialog.showModal(); }, {signal});
  close.addEventListener("click", () => dialog.close(), {signal});
  dialog.addEventListener("cancel", event => { event.preventDefault(); dialog.close(); }, {signal});
  dialog.addEventListener("close", () => button.focus(), {signal});
  render();
}
