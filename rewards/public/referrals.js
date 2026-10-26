(() => {
  const root = document.getElementById("referralAdmin");
  if (!root) return;
  let program, dirty = false, saving = false, loading = false, loaded = false, previewCount = 0;
  const esc = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  const api = async (method = "GET", body) => {
    const response = await fetch("/api/admin/referrals", { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || "Unable to save referral settings.");
    return data.program;
  };
  function status(message, error = false) {
    const node = root.querySelector("#referralStatus");
    if (node) { node.className = `status ${error ? "error" : "success"}`; node.textContent = message; }
  }
  function markDirty() { dirty = true; status("Unsaved changes"); preview(); }
  function render() {
    root.innerHTML = `<div class="referral-admin-layout">
      <form id="referralForm" class="card form-stack">
        <p class="eyebrow">Invite friends</p><h2>Referral program</h2>
        <p class="referral-draft">Draft configuration — referral tracking and reward issuance are not enabled yet.</p>
        <div class="two-col"><label>Friend discount (store currency)<input name="friendDiscountAmount" type="number" min="0.01" max="10000" step="0.01" value="${program.friendDiscountAmount}" required></label>
        <label>Points per successful referral<input name="referrerPoints" type="number" min="1" max="100000" step="1" value="${program.referrerPoints}" required></label></div>
        <div class="two-col"><label>Minimum qualifying order<input name="minimumOrderAmount" type="number" min="0" max="10000" step="0.01" value="${program.minimumOrderAmount}" required></label>
        <label>Referral link attribution (days)<input name="attributionDays" type="number" min="1" max="365" value="${program.attributionDays}" required></label></div>
        <h3>Referral milestones</h3><p class="muted">Products can be selected later. Use a bundle product for a bundle gift. Milestones display in referral-count order.</p>
        <div id="referralMilestones">${program.milestones.map(row).join("")}</div>
        <div class="referral-actions"><button type="button" class="secondary" data-add="PRODUCT">Add product milestone</button><button type="button" class="secondary" data-add="POINTS">Add bonus-points milestone</button></div>
        <div class="referral-actions"><button type="submit" id="saveReferrals">Save draft</button><button type="button" class="secondary" id="reloadReferrals">Reload saved settings</button></div>
        <p id="referralStatus" class="status" role="status" aria-live="polite">${dirty ? "Unsaved changes" : "Draft loaded"}</p>
      </form>
      <aside class="referral-preview-panel"><label>Preview successful referrals<input id="referralPreviewCount" type="number" min="0" max="100000" value="${previewCount}"></label><div id="referralPreview"></div></aside>
    </div>`;
    preview();
  }
  function row(m) {
    const base = m.kind === "REFERRAL_POINTS";
    const variants = m._variants || (m.variantId ? [{ id: m.variantId, title: m.variantTitle || m.variantId }] : []);
    return `<fieldset class="referral-milestone" data-milestone="${esc(m.id)}"><legend>${base ? "First referral — base points" : esc(m.kind === "PRODUCT" ? "Free product" : "Bonus points")}</legend>
      <div class="two-col"><label>Successful referrals<input data-field="threshold" type="number" min="${base ? 1 : 2}" max="100000" value="${m.threshold}" ${base ? "disabled" : "required"}></label>
      <label>Display title<input data-field="title" maxlength="100" value="${esc(m.title)}" ${base ? "disabled" : "required"}></label></div>
      ${base ? '<p class="muted">This shows the points earned for the first referral. It does not award a second bonus.</p>' : m.kind === "POINTS"
        ? `<label>Extra bonus points<input data-field="points" type="number" min="1" max="100000" value="${m.points || 200}" required></label>`
        : `<p>${m.productTitle ? esc(m.productTitle) : "No product selected — saved as a draft"}</p>
          <div class="two-col"><label>Gift variant<select data-field="variantId"><option value="">Select a variant</option>${variants.map(v => `<option value="${esc(v.id)}" ${v.id === m.variantId ? "selected" : ""}>${esc(v.title)}</option>`).join("")}</select></label>
          <label>Gift quantity<input data-field="quantity" type="number" min="1" max="10" value="${m.quantity || 1}" required></label></div>
          <div class="referral-actions"><button type="button" class="secondary" data-pick="${esc(m.id)}">Select product</button><button type="button" class="secondary" data-clear="${esc(m.id)}">Clear product</button></div>`}
      ${base ? "" : `<button type="button" class="secondary" data-remove="${esc(m.id)}">Remove milestone</button>`}</fieldset>`;
  }
  function preview() {
    const target = root.querySelector("#referralPreview");
    if (!target) return;
    const milestones = [...program.milestones].sort((a, b) => a.threshold - b.threshold);
    const next = milestones.find(m => m.threshold > previewCount), max = next?.threshold || milestones.at(-1)?.threshold || 1;
    const discount = Number(program.friendDiscountAmount).toLocaleString(undefined, { maximumFractionDigits: 2 });
    target.innerHTML = `<div class="referral-preview"><p class="referral-eyebrow">INVITE FRIENDS</p><h2>Refer &amp; Earn</h2>
      <section class="referral-offer"><span class="referral-offer-icon" aria-hidden="true">♧</span><h2>Give ${esc(discount)} off, Get ${esc(program.referrerPoints)} pts</h2><p>Share FreeTheRoots with friends. They get ${esc(discount)} off their first order, you earn ${esc(program.referrerPoints)} points when they buy.</p><small>Discount amounts are in your store currency.</small></section>
      <section class="referral-preview-card"><p class="referral-eyebrow">YOUR UNIQUE LINK</p><p class="muted">A personal link and code will appear here when referral tracking is enabled.</p><div class="referral-share"><span>Text</span><span>Email</span><span>More</span></div></section>
      <section class="referral-preview-card"><div class="referral-progress-title"><h3>Referral progress</h3><strong>${esc(previewCount)}/${esc(max)}</strong></div>
      <progress max="${esc(max)}" value="${esc(Math.min(previewCount, max))}" aria-label="Referral progress"></progress>
      <p>${next ? `${esc(next.threshold - previewCount)} more friends to unlock ${esc(next.title)}.` : "All configured milestones unlocked."}</p>
      <ul>${milestones.map(m => `<li><span class="referral-step ${previewCount >= m.threshold ? "unlocked" : ""}">${previewCount >= m.threshold ? "✓" : esc(m.threshold)}</span><span>${esc(m.threshold)} ${m.threshold === 1 ? "referral" : "referrals"} — ${esc(m.kind === "REFERRAL_POINTS" ? program.referrerPoints + " points" : m.title)}</span><small>${previewCount >= m.threshold ? "Unlocked" : "Locked"}</small></li>`).join("")}</ul></section>
      <p class="muted">Admin preview with a sample referral count. No rewards are issued from this preview.</p></div>`;
  }
  async function load(force = false) {
    if ((loaded && !force) || loading) return;
    loading = true; root.inert = true;
    try { program = await api(); loaded = true; dirty = false; render(); }
    catch (error) { if (loaded) status(error.message, true); else root.textContent = error.message; }
    finally { loading = false; root.inert = false; }
  }
  window.loadReferrals = load;
  root.addEventListener("input", event => {
    if (event.target.id === "referralPreviewCount") { previewCount = Math.max(0, Math.min(100000, Number(event.target.value) || 0)); preview(); return; }
    if (saving || loading || !program) return;
    const field = event.target.dataset.field;
    if (field) {
      const milestone = program.milestones.find(m => m.id === event.target.closest("[data-milestone]")?.dataset.milestone);
      if (!milestone) return;
      milestone[field] = ["threshold", "quantity", "points"].includes(field) ? Number(event.target.value) : event.target.value;
      if (field === "variantId") milestone.variantTitle = milestone._variants?.find(v => v.id === milestone.variantId)?.title || milestone.variantTitle;
    } else if (event.target.name) program[event.target.name] = Number(event.target.value);
    markDirty();
  });
  root.addEventListener("click", async event => {
    const button = event.target.closest("button");
    if (!button || saving || loading) return;
    if (button.id === "reloadReferrals") {
      if (dirty && !window.confirm("Discard unsaved referral settings?")) return;
      await load(true); return;
    }
    if (button.dataset.add) {
      if (program.milestones.length >= 50) { status("You can configure up to 50 milestones.", true); return; }
      const threshold = Math.max(1, ...program.milestones.map(m => Number(m.threshold) || 1)) + 1;
      program.milestones.push({ id: crypto.randomUUID(), kind: button.dataset.add, threshold, title: button.dataset.add === "POINTS" ? "Bonus points" : "Free gift", points: 200, quantity: 1, productId: null, variantId: null });
      markDirty(); render(); return;
    }
    const id = button.dataset.remove || button.dataset.pick || button.dataset.clear;
    const m = program?.milestones.find(item => item.id === id);
    if (!m || m.kind === "REFERRAL_POINTS") return;
    if (button.dataset.remove) program.milestones = program.milestones.filter(item => item.id !== id);
    if (button.dataset.clear) Object.assign(m, { productId: null, variantId: null, productTitle: "", variantTitle: "", _variants: [] });
    if (button.dataset.pick) {
      if (!window.shopify?.resourcePicker) { status("Open this app inside Shopify Admin to select a product.", true); return; }
      try {
        const result = await window.shopify.resourcePicker({ type: "product", action: "select", multiple: false, filter: { variants: true }, ...(m.productId ? { selectionIds: [{ id: m.productId }] } : {}) });
        if (!result?.length) return;
        const product = result[0], variants = product.variants || [];
        if (!variants.length) { status("No variants are available for this product.", true); return; }
        const selected = variants.find(v => v.id === m.variantId) || (variants.length === 1 ? variants[0] : null);
        Object.assign(m, { productId: product.id, productTitle: product.title, _variants: variants.map(v => ({ id: v.id, title: v.title })), variantId: selected?.id || null, variantTitle: selected?.title || "" });
      } catch (error) { status(error.message || "Unable to open product picker.", true); return; }
    }
    markDirty(); render();
  });
  root.addEventListener("submit", async event => {
    if (event.target.id !== "referralForm") return;
    event.preventDefault(); if (saving) return;
    saving = true;
    // Prevent edits during save from being overwritten by the response.
    root.querySelector("#referralForm").inert = true;
    try {
      program = await api("PUT", program); dirty = false; render(); status("Referral draft saved. You can select or change gifts later.");
    } catch (error) { status(error.message, true); }
    finally { saving = false; root.querySelector("#referralForm").inert = false; }
  });
  window.addEventListener("beforeunload", event => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });
})();
