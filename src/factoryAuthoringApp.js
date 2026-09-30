import { reviewFactoryPromotion, createPromotionPackage, validatePromotionPackage, promotionReceipt, recognizePromotions } from "./factoryPromotion.js";

export function mountFactoryAuthoring({ container, catalogue, owner, readDraft, resolveImage, makeThumbnail, download, accountAdmin = false }) {
  if (!accountAdmin && globalThis.WireNexusBuildCapabilities?.factoryAuthoring !== true) return null;
  const section = document.createElement("section");
  section.id = "factoryAuthoring";
  section.style.cssText = "border-top:1px solid var(--line);margin-top:16px;padding-top:12px;max-width:100%;overflow:auto;overflow-wrap:anywhere";
  const heading = document.createElement("h3"); heading.textContent = "WireNexus Library Administration";
  const status = document.createElement("div"); status.id = "factoryPromotionStatus"; status.setAttribute("role", "status");
  const actions = document.createElement("div"); actions.className = "editor-default-buttons";
  const button = (text, id, action) => {
    const element = document.createElement("button"); element.type = "button"; element.className = "tool-button"; element.textContent = text; element.id = id;
    element.addEventListener("click", () => run(action)); actions.append(element); return element;
  };
  const reviewArea = document.createElement("div"), queueArea = document.createElement("ul"), message = document.createElement("div");
  reviewArea.style.cssText = "max-height:40vh;overflow:auto";
  message.setAttribute("role", "status"); message.id = "factoryPromotionMessage";
  let queue = [], busy = false;
  const run = async action => {
    if (busy) return;
    busy = true; message.textContent = "";
    try { await action(); } catch (error) { message.textContent = `Promotion not completed: ${error.message}`; }
    finally { busy = false; refresh(); }
  };
  function refresh() {
    const id = readDraft(false)?.personalId;
    const receipts = owner.promotionReceipts().filter(r => r.sourceId === id || r.targetId === id);
    const latest = receipts.at(-1);
    status.textContent = latest ? `${latest.targetId}: ${latest.status.replace(/Factory/g, 'WireNexus Library')}` : "No exported promotion for this device";
    promote.disabled = busy; exportButton.disabled = busy || !queue.length;
    queueArea.replaceChildren();
    for (const [index, review] of queue.entries()) {
      const row = document.createElement("li"), remove = document.createElement("button");
      row.textContent = `${review.targetId}: ${review.records.filter(r => r.baseFingerprint !== r.candidateFingerprint).length} changed definitions `;
      remove.type = "button"; remove.className = "tool-button"; remove.textContent = "Remove"; remove.disabled = busy;
      remove.addEventListener("click", () => { queue.splice(index, 1); refresh(); });
      const details = document.createElement("details"), summary = document.createElement("summary"), pre = document.createElement("pre");
      summary.textContent = "Review queued snapshot"; pre.style.cssText = "white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto";
      pre.textContent = JSON.stringify(review.records, null, 2); details.append(summary, pre); row.append(remove, details); queueArea.append(row);
    }
  }
  function showReviewOptions() {
    const draft = readDraft(true);
    if (!draft?.definition) throw new Error("Select a device first.");
    const capture = structuredClone(draft);
    reviewArea.replaceChildren();
    const mode = document.createElement("select"); mode.id = "factoryPromotionMode"; mode.setAttribute("aria-label", "WireNexus Library promotion mode");
    const counterpart = catalogue.devices.find(d => d.id === (capture.definition.factoryTemplateId || capture.definition.id));
    for (const [value, text] of [...(counterpart ? [["update", `Update WireNexus Library ${counterpart.id}`]] : []), ["new", "Add new WireNexus Library device"]]) {
      const option = document.createElement("option"); option.value = value; option.textContent = text; mode.append(option);
    }
    const id = document.createElement("input"); id.id = "factoryPromotionTarget"; id.setAttribute("aria-label", "Stable WireNexus Library ID");
    const choose = () => {
      id.disabled = mode.value === "update";
      id.value = mode.value === "update" ? counterpart.id : !counterpart ? capture.definition.id : `factory-${crypto.randomUUID()}`;
    };
    mode.addEventListener("change", choose); choose();
    const inspect = document.createElement("button"); inspect.type = "button"; inspect.className = "tool-button"; inspect.id = "reviewFactoryPromotion"; inspect.textContent = "Review Changes";
    const detail = document.createElement("div"); detail.id = "factoryPromotionReview";
    inspect.addEventListener("click", () => run(async () => {
      detail.replaceChildren();
      const review = await reviewFactoryPromotion({ ...capture, catalogue, targetId: id.value.trim(), mode: mode.value, resolveImage, makeThumbnail });
      await validatePromotionPackage(await createPromotionPackage([review]), catalogue);
      const list = document.createElement("ul");
      for (const row of review.records) {
        const item = document.createElement("li");
        item.textContent = `${row.kind} ${row.id}: ${row.baseFingerprint === row.candidateFingerprint ? "unchanged dependency" : row.baseFingerprint ? "update" : "new"}; fields: ${row.review.changes.join(", ") || "none"}${row.review.cards.length ? `; cards: ${row.review.cards.join(", ")}` : ""}${row.review.sharedUsers.length ? `; shared impact: ${row.review.sharedUsers.join(", ")}` : ""}`;
        const diff = document.createElement("details"), summary = document.createElement("summary"), pre = document.createElement("pre");
        summary.textContent = "Candidate definition"; pre.style.cssText = "white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto";
        pre.textContent = JSON.stringify({ previousChangedFields: row.review.before, candidate: row.definition }, null, 2); diff.append(summary, pre); item.append(diff); list.append(item);
      }
      const artwork = document.createElement("p"); artwork.textContent = `${Object.keys(review.assets).length} portable artwork assets. No missing dependencies.`;
      const confirmLabel = document.createElement("label"), confirm = document.createElement("input"); confirm.type = "checkbox"; confirm.id = "confirmFactoryDependencies";
      confirmLabel.append(confirm, " Approve these definitions, dependencies and shared impacts");
      const enqueue = document.createElement("button"); enqueue.type = "button"; enqueue.className = "primary-button"; enqueue.id = "queueFactoryPromotion"; enqueue.textContent = "Queue Reviewed Snapshot"; enqueue.disabled = true;
      confirm.addEventListener("change", () => { enqueue.disabled = !confirm.checked; });
      enqueue.addEventListener("click", () => run(async () => {
        await validatePromotionPackage(await createPromotionPackage([...queue, review]), catalogue); queue.push(review); reviewArea.replaceChildren();
        message.textContent = "Reviewed snapshot queued. Later draft edits will not change it.";
      }));
      detail.append(list, artwork, confirmLabel, enqueue);
    }));
    reviewArea.append(mode, id, inspect, detail);
  }
  const promote = button("Promote to WireNexus Device Library", "promoteToFactory", showReviewOptions);
  const exportButton = button("Export Promotions", "exportFactoryPromotions", async () => {
    const pkg = await createPromotionPackage(queue);
    await validatePromotionPackage(pkg, catalogue);
    await owner.refresh();
    const receipts = [];
    for (const review of queue) receipts.push(await promotionReceipt(review, owner, catalogue, pkg.packageId));
    await owner.recordPromotionReceipts(receipts); // Failed persistence must not claim a tracked export.
    download("wirenexus-factory-promotion.json", JSON.stringify(pkg, null, 2));
    queue = []; message.textContent = "Export prepared. Awaiting repository import and deployment; personal definitions retained.";
  });
  button("Compare with WireNexus Library", "compareFactoryPromotion", async () => {
    await recognizePromotions(owner, catalogue);
    const draft = readDraft(false), factory = catalogue.devices.find(d => d.id === (draft?.definition.factoryTemplateId || draft?.definition.id));
    const pre = document.createElement("pre"); pre.style.cssText = "white-space:pre-wrap;overflow-wrap:anywhere;max-height:300px;overflow:auto";
    pre.textContent = JSON.stringify({ factory: factory || null, personal: draft && owner.entry(draft.personalId)?.definition || null }, null, 2);
    reviewArea.replaceChildren(pre);
  });
  section.append(heading, status, actions, message, queueArea, reviewArea); container.append(section); refresh();
  return Object.freeze({ refresh, dispose: () => section.remove() });
}
