(() => {
  function syncState(reward) {
    const status = String(reward?.shopifySync?.status || "PENDING").toUpperCase();
    const states = {
      SYNCED: ["Shopify: Synced ✓", "sync-synced"],
      PENDING: ["Shopify: Pending…", "sync-pending"],
      SYNCING: ["Shopify: Syncing…", "sync-pending"],
      FAILED: ["Shopify: Failed ⚠", "sync-failed"],
    };
    const [label, cls] = states[status] || [`Shopify: ${status}`, "sync-pending"];
    return { status, label, cls };
  }

  async function enhancedLoadRewards() {
    const { rewards } = await api("/api/admin/rewards");
    rewardsCache = rewards;
    const root = $("rewardsList");
    root.innerHTML = "";
    root.className = rewards.length ? "list" : "list empty";
    if (!rewards.length) {
      root.textContent = "No rewards yet.";
      return;
    }

    rewards.forEach((reward) => {
      const sync = syncState(reward);
      const syncError = reward?.shopifySync?.lastError || reward?.shopifySync?.error || "";
      const row = document.createElement("div");
      row.className = "customer admin-row";
      row.innerHTML = `<div><strong>${escapeHtml(reward.name)}</strong><small>${escapeHtml(reward.type.replaceAll("_", " "))} · ${Number(reward.pointsCost).toLocaleString()} pts</small>${syncError ? `<small class="sync-error" title="${escapeHtml(syncError)}">${escapeHtml(syncError)}</small>` : ""}</div><div class="row-actions"><span class="badge ${reward.enabled ? "enabled" : "disabled"}">${reward.enabled ? "Enabled" : "Disabled"}</span><span class="badge ${sync.cls}">${escapeHtml(sync.label)}</span>${sync.status === "FAILED" ? `<button type="button" class="secondary retry-reward-sync" data-id="${reward._id}">Retry sync</button>` : ""}<button type="button" class="secondary toggle-reward" data-id="${reward._id}">${reward.enabled ? "Disable" : "Enable"}</button><button type="button" class="secondary edit-reward" data-id="${reward._id}">Edit</button></div>`;
      root.appendChild(row);
    });
  }

  loadRewards = enhancedLoadRewards;

  document.addEventListener("click", async (event) => {
    const button = event.target.closest(".retry-reward-sync");
    if (!button) return;
    button.disabled = true;
    button.textContent = "Retrying…";
    try {
      await api(`/api/admin/rewards/${button.dataset.id}/retry-sync`, { method: "POST" });
      await enhancedLoadRewards();
    } catch (error) {
      button.disabled = false;
      button.textContent = "Retry sync";
      window.alert(`Shopify sync retry failed: ${error.message}`);
    }
  });

  if (document.documentElement.dataset.rewardsView === "rewards") {
    enhancedLoadRewards().catch(() => {});
  }
})();
