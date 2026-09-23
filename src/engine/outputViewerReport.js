export function installOutputReport(viewer, report = {}, cableGroups = []) {
  const host = viewer.host, toolbar = host.querySelector('[role="toolbar"]');
  const button = document.createElement("button"); button.type = "button"; button.textContent = "Report"; button.dataset.action = "report";
  toolbar.prepend(button);
  const dialog = document.createElement("dialog"); dialog.className = "output-report"; dialog.setAttribute("aria-label", "Project Report");
  const header = document.createElement("header"), title = document.createElement("h2"), close = document.createElement("button");
  title.textContent = "Project Report"; close.textContent = "Close"; close.type = "button";
  header.append(title, close); dialog.append(header); host.append(dialog);
  const body = document.createElement("div"); body.className = "output-report-body"; dialog.append(body);
  const text = (tag, value) => { const el = document.createElement(tag); el.textContent = String(value ?? ""); return el; };
  if (report.summary?.length) {
    const summary = document.createElement("dl"); summary.className = "output-report-summary";
    for (const item of report.summary) summary.append(text("dt", item.label), text("dd", item.value));
    body.append(summary);
  }
  const table = (heading, columns, rows, cable = false) => {
    if (!rows?.length) return;
    body.append(text("h3", heading));
    const wrap = document.createElement("div"); wrap.className = "output-report-table";
    const grid = document.createElement("table"), head = document.createElement("thead"), row = document.createElement("tr");
    for (const [, label] of columns) row.append(text("th", label));
    head.append(row); grid.append(head);
    const tbody = document.createElement("tbody");
    rows.forEach(item => {
      const tr = document.createElement("tr");
      columns.forEach(([key], index) => {
        const td = text("td", item[key]);
        if (cable && index === 0) {
          const action = text("button", item[key]); action.type = "button";
          action.addEventListener("click", () => {
            const ids = cableGroups.find(g => g.typeId === item.typeId && g.length === item.length)?.wireIds || [];
            viewer.select(ids.length === 1 ? { type: "wire", id: ids[0] } : { type: "multi-wire", ids }); dialog.close();
          }, { signal: viewer.abort.signal });
          td.replaceChildren(action);
        }
        tr.append(td);
      }); tbody.append(tr);
    }); grid.append(tbody); wrap.append(grid); body.append(wrap);
  };
  table("Devices", [["quantity", "Qty"], ["brand", "Brand"], ["type", "Device"], ["power", "Power"]], report.deviceRows);
  table("Adapters / Breakouts", [["quantity", "Qty"], ["brand", "Brand"], ["type", "Adapter / Breakout"], ["category", "Category"]], report.adapterRows);
  table("Racks", [["name", "Rack"], ["devices", "Devices"], ["power", "Power"]], report.rackRows);
  table("LED Screens", [["name", "Screen"], ["size", "Physical Size"], ["pixels", "Pixels"]], report.screenRows);
  table("Cable Schedule", [["type", "Cable"], ["length", "Length"], ["quantity", "Qty"]], report.cableRows, true);
  for (const section of report.matrixSections || []) table(`Matrix Routing - ${[section.brand, section.name].filter(Boolean).join(" / ")} (${section.size || ""})`,
    [["output", "Output"], ["input", "Input Source"]], section.routeRows);
  button.addEventListener("click", () => dialog.showModal(), { signal: viewer.abort.signal });
  close.addEventListener("click", () => dialog.close(), { signal: viewer.abort.signal });
}
