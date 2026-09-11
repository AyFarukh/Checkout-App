const $ = (id) => document.getElementById(id);

function config() {
  return {
    shop: $("shop").value.trim(),
    key: $("adminKey").value.trim(),
  };
}

async function api(path, options = {}) {
  const { key } = config();
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-rewards-admin-key": key,
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

async function checkHealth() {
  try {
    const response = await fetch("/health");
    const data = await response.json();
    const connected = data.database?.status === "connected";
    $("healthDot").className = `dot ${connected ? "ok" : "bad"}`;
    $("healthText").textContent = connected ? "MongoDB connected" : `MongoDB ${data.database?.status || "unavailable"}`;
  } catch {
    $("healthDot").className = "dot bad";
    $("healthText").textContent = "Service unavailable";
  }
}

function requireSetup() {
  const { shop, key } = config();
  if (!shop || !key) throw new Error("Enter the shop domain and admin key first");
  return { shop, key };
}

async function loadDashboard() {
  const { shop } = requireSetup();
  const data = await api(`/api/admin/dashboard?shop=${encodeURIComponent(shop)}`);
  $("members").textContent = data.members.toLocaleString();
  $("outstanding").textContent = data.pointsOutstanding.toLocaleString();
  $("earned").textContent = data.lifetimeEarned.toLocaleString();
  $("redeemed").textContent = data.lifetimeRedeemed.toLocaleString();
  renderActivity(data.recent || []);
}

async function searchCustomers() {
  const { shop } = requireSetup();
  const q = $("customerSearch").value.trim();
  const data = await api(`/api/admin/customers?shop=${encodeURIComponent(shop)}&q=${encodeURIComponent(q)}`);
  const root = $("customerResults");
  root.className = "list";
  root.innerHTML = "";

  if (!data.customers.length) {
    root.className = "list empty";
    root.textContent = "No matching reward customers.";
    return;
  }

  for (const customer of data.customers) {
    const row = document.createElement("div");
    row.className = "customer";
    const name = [customer.firstName, customer.lastName].filter(Boolean).join(" ") || "Unnamed customer";
    row.innerHTML = `<div><strong>${escapeHtml(name)}</strong><small>${escapeHtml(customer.email || customer.shopifyCustomerId)}</small></div><strong>${Number(customer.pointsBalance || 0).toLocaleString()} pts</strong>`;
    row.addEventListener("click", () => {
      $("customerId").value = customer.shopifyCustomerId;
    });
    root.appendChild(row);
  }
}

function renderActivity(transactions) {
  const body = $("activityBody");
  body.innerHTML = "";
  if (!transactions.length) {
    body.innerHTML = '<tr><td colspan="6">No reward activity yet.</td></tr>';
    return;
  }

  for (const tx of transactions) {
    const tr = document.createElement("tr");
    const points = Number(tx.points || 0);
    tr.innerHTML = `
      <td>${new Date(tx.createdAt).toLocaleString()}</td>
      <td>${escapeHtml(tx.shopifyCustomerId)}</td>
      <td>${escapeHtml(tx.type)}</td>
      <td class="${points >= 0 ? "points-positive" : "points-negative"}">${points > 0 ? "+" : ""}${points}</td>
      <td>${escapeHtml(tx.source)}</td>
      <td>${Number(tx.balanceAfter || 0).toLocaleString()}</td>
    `;
    body.appendChild(tr);
  }
}

async function refreshActivity() {
  const { shop } = requireSetup();
  const data = await api(`/api/admin/activity?shop=${encodeURIComponent(shop)}`);
  renderActivity(data.transactions || []);
}

async function submitAdjustment(event) {
  event.preventDefault();
  const status = $("adjustStatus");
  status.className = "status";
  status.textContent = "Saving…";

  try {
    const { shop } = requireSetup();
    const customerId = $("customerId").value.trim();
    if (!customerId) throw new Error("Shopify customer ID is required");

    const data = await api(`/api/admin/customers/${encodeURIComponent(customerId)}/adjust`, {
      method: "POST",
      body: JSON.stringify({
        shop,
        operation: $("operation").value,
        points: Number($("points").value),
        reason: $("reason").value.trim(),
        note: $("note").value.trim(),
        createdBy: "rewards-admin",
      }),
    });

    status.className = "status success";
    status.textContent = `Saved. New balance: ${data.customer.pointsBalance.toLocaleString()} points.`;
    $("points").value = "";
    $("reason").value = "";
    $("note").value = "";
    await loadDashboard();
  } catch (error) {
    status.className = "status error";
    status.textContent = error.message;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

$("loadDashboard").addEventListener("click", () => loadDashboard().catch((error) => alert(error.message)));
$("searchCustomers").addEventListener("click", () => searchCustomers().catch((error) => alert(error.message)));
$("refreshActivity").addEventListener("click", () => refreshActivity().catch((error) => alert(error.message)));
$("adjustForm").addEventListener("submit", submitAdjustment);

checkHealth();
