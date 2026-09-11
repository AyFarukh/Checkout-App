const $ = (id) => document.getElementById(id);
let session = { shop: "" };
let selectedCustomer = null;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function routeView() {
  const map = { "/": "overview", "/customers": "customers", "/activity": "activity", "/earn-rules": "earn-rules", "/rewards": "rewards", "/settings": "settings" };
  const view = map[location.pathname] || "overview";
  document.querySelectorAll(".view").forEach((node) => { node.hidden = node.dataset.view !== view; });
  const titles = { overview: "Rewards overview", customers: "Customers", activity: "Points activity", "earn-rules": "Earn rules", rewards: "Rewards", settings: "Settings" };
  $("pageTitle").textContent = titles[view];
  if (view === "overview") loadDashboard();
  if (view === "activity") loadActivity();
  if (view === "earn-rules") loadRules();
  if (view === "rewards") loadRewards();
  if (view === "settings") loadSettings();
}

async function initialize() {
  await checkHealth();
  try {
    session = await api("/api/admin/session");
    routeView();
  } catch (error) {
    $("healthDot").className = "dot bad";
    $("healthText").textContent = error.message;
  }
}

async function checkHealth() {
  try {
    const data = await (await fetch("/health")).json();
    const connected = data.database?.status === "connected";
    $("healthDot").className = `dot ${connected ? "ok" : "bad"}`;
    $("healthText").textContent = connected ? "Rewards database connected" : `MongoDB ${data.database?.status || "unavailable"}`;
  } catch {
    $("healthDot").className = "dot bad";
    $("healthText").textContent = "Rewards service unavailable";
  }
}

function renderTransactions(target, transactions) {
  const body = $(target);
  body.innerHTML = "";
  if (!transactions?.length) { body.innerHTML = '<tr><td colspan="6">No reward activity yet.</td></tr>'; return; }
  for (const tx of transactions) {
    const points = Number(tx.points || 0);
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${new Date(tx.createdAt).toLocaleString()}</td><td>${escapeHtml(tx.shopifyCustomerId)}</td><td>${escapeHtml(tx.type)}</td><td class="${points >= 0 ? "points-positive" : "points-negative"}">${points > 0 ? "+" : ""}${points}</td><td>${escapeHtml(tx.source)}</td><td>${Number(tx.balanceAfter || 0).toLocaleString()}</td>`;
    body.appendChild(tr);
  }
}

async function loadDashboard() {
  const data = await api("/api/admin/dashboard");
  $("members").textContent = Number(data.members || 0).toLocaleString();
  $("outstanding").textContent = Number(data.pointsOutstanding || 0).toLocaleString();
  $("earned").textContent = Number(data.lifetimeEarned || 0).toLocaleString();
  $("redeemed").textContent = Number(data.lifetimeRedeemed || 0).toLocaleString();
  renderTransactions("dashboardActivity", data.recent);
}

async function shopifyCustomers(query) {
  const graphql = `query RewardsCustomers($query: String!) { customers(first: 20, query: $query) { nodes { id displayName email firstName lastName } } }`;
  const response = await fetch("shopify:admin/api/graphql.json", { method: "POST", body: JSON.stringify({ query: graphql, variables: { query } }) });
  const payload = await response.json();
  if (payload.errors?.length) throw new Error(payload.errors[0].message);
  return payload.data?.customers?.nodes || [];
}

async function searchCustomers() {
  const q = $("customerSearch").value.trim();
  if (!q) throw new Error("Enter a customer name or email");
  const customers = await shopifyCustomers(q);
  const root = $("customerResults");
  root.innerHTML = "";
  root.className = customers.length ? "list" : "list empty";
  if (!customers.length) { root.textContent = "No Shopify customers found."; return; }
  for (const customer of customers) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "customer customer-button";
    row.innerHTML = `<div><strong>${escapeHtml(customer.displayName || "Unnamed customer")}</strong><small>${escapeHtml(customer.email || customer.id)}</small></div><span>Select</span>`;
    row.onclick = () => selectCustomer(customer);
    root.appendChild(row);
  }
}

function selectCustomer(customer) {
  selectedCustomer = customer;
  $("customerId").value = customer.id;
  $("selectedCustomerName").value = `${customer.displayName || "Customer"}${customer.email ? ` — ${customer.email}` : ""}`;
  $("adjustStatus").textContent = "Customer selected. Enter a points adjustment.";
}

async function submitAdjustment(event) {
  event.preventDefault();
  const status = $("adjustStatus");
  try {
    if (!selectedCustomer) throw new Error("Select a Shopify customer first");
    const data = await api(`/api/admin/customers/${encodeURIComponent(selectedCustomer.id)}/adjust`, {
      method: "POST",
      body: JSON.stringify({
        operation: $("operation").value,
        points: Number($("points").value),
        reason: $("reason").value.trim(),
        note: $("note").value.trim(),
        customer: { email: selectedCustomer.email, firstName: selectedCustomer.firstName, lastName: selectedCustomer.lastName },
      }),
    });
    status.className = "status success";
    status.textContent = `Saved. New balance: ${Number(data.customer.pointsBalance).toLocaleString()} points.`;
    $("points").value = ""; $("reason").value = ""; $("note").value = "";
  } catch (error) { status.className = "status error"; status.textContent = error.message; }
}

async function loadActivity() { const data = await api("/api/admin/activity"); renderTransactions("activityBody", data.transactions); }

async function loadRules() {
  const { rules } = await api("/api/admin/earning-rules");
  const root = $("rulesList"); root.innerHTML = ""; root.className = rules.length ? "list" : "list empty";
  if (!rules.length) { root.textContent = "No earning rules yet."; return; }
  rules.forEach((rule) => { const row = document.createElement("div"); row.className = "customer"; row.innerHTML = `<div><strong>${escapeHtml(rule.name)}</strong><small>${escapeHtml(rule.type.replaceAll("_", " "))}</small></div><strong>${rule.pointsPerDollar ? `${rule.pointsPerDollar} / $1` : `${rule.points} pts`}</strong>`; root.appendChild(row); });
}

async function createRule(event) {
  event.preventDefault();
  await api("/api/admin/earning-rules", { method: "POST", body: JSON.stringify({ name: $("ruleName").value.trim(), type: $("ruleType").value, points: Number($("rulePoints").value || 0), pointsPerDollar: Number($("rulePerDollar").value || 0), enabled: true }) });
  event.target.reset(); await loadRules();
}

async function loadRewards() {
  const { rewards } = await api("/api/admin/rewards");
  const root = $("rewardsList"); root.innerHTML = ""; root.className = rewards.length ? "list" : "list empty";
  if (!rewards.length) { root.textContent = "No rewards yet."; return; }
  rewards.forEach((reward) => { const row = document.createElement("div"); row.className = "customer"; row.innerHTML = `<div><strong>${escapeHtml(reward.name)}</strong><small>${escapeHtml(reward.type.replaceAll("_", " "))}</small></div><strong>${Number(reward.pointsCost).toLocaleString()} pts</strong>`; root.appendChild(row); });
}

async function createReward(event) {
  event.preventDefault();
  await api("/api/admin/rewards", { method: "POST", body: JSON.stringify({ name: $("rewardName").value.trim(), type: $("rewardType").value, pointsCost: Number($("rewardCost").value), discountValue: Number($("rewardValue").value || 0), minimumSpend: Number($("rewardMinimum").value || 0), enabled: true }) });
  event.target.reset(); await loadRewards();
}

async function loadSettings() {
  const { settings } = await api("/api/admin/settings");
  $("pointSingular").value = settings.pointNameSingular || "point"; $("pointPlural").value = settings.pointNamePlural || "points"; $("expireEnabled").checked = !!settings.pointsExpireEnabled; $("expireDays").value = settings.pointsExpireAfterDays || 365; $("refundPolicy").value = settings.refundPolicy || "REVERSE_PROPORTIONAL"; $("discountCombinations").checked = !!settings.allowDiscountCombinations;
}

async function saveSettings(event) {
  event.preventDefault();
  const status = $("settingsStatus");
  try {
    await api("/api/admin/settings", { method: "PUT", body: JSON.stringify({ pointNameSingular: $("pointSingular").value.trim() || "point", pointNamePlural: $("pointPlural").value.trim() || "points", pointsExpireEnabled: $("expireEnabled").checked, pointsExpireAfterDays: Number($("expireDays").value || 365), refundPolicy: $("refundPolicy").value, allowDiscountCombinations: $("discountCombinations").checked }) });
    status.className = "status success"; status.textContent = "Settings saved.";
  } catch (error) { status.className = "status error"; status.textContent = error.message; }
}

function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }

$("refreshDashboard").onclick = () => loadDashboard().catch((e) => alert(e.message));
$("searchCustomers").onclick = () => searchCustomers().catch((e) => alert(e.message));
$("adjustForm").addEventListener("submit", submitAdjustment);
$("refreshActivity").onclick = () => loadActivity().catch((e) => alert(e.message));
$("ruleForm").addEventListener("submit", (e) => createRule(e).catch((error) => alert(error.message)));
$("rewardForm").addEventListener("submit", (e) => createReward(e).catch((error) => alert(error.message)));
$("settingsForm").addEventListener("submit", saveSettings);

initialize();
