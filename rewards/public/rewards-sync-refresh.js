(() => {
  const POLL_MS = 1500;
  const MAX_POLLS = 20;
  let timer = null;
  let polls = 0;
  let running = false;

  function onRewardsPage() {
    return location.pathname === "/rewards";
  }

  function hasTransitionalSync() {
    const root = document.getElementById("rewardsList");
    if (!root) return false;
    const text = root.textContent || "";
    return text.includes("Shopify: Pending") || text.includes("Shopify: Syncing");
  }

  async function refreshOnce() {
    if (running || !onRewardsPage() || typeof window.loadRewards !== "function") return;
    running = true;
    try {
      await window.loadRewards();
    } catch (error) {
      console.warn("[Rewards Admin] sync status refresh failed", error?.message || error);
    } finally {
      running = false;
    }
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    polls = 0;
  }

  function start() {
    if (!onRewardsPage() || timer) return;
    polls = 0;
    timer = setInterval(async () => {
      polls += 1;
      await refreshOnce();
      if (!hasTransitionalSync() || polls >= MAX_POLLS) stop();
    }, POLL_MS);
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest(".retry-reward-sync")) {
      setTimeout(start, 250);
    }
  });

  document.addEventListener("rewards:shopify-token-ready", () => {
    if (onRewardsPage()) start();
  });

  window.addEventListener("popstate", () => {
    stop();
    if (onRewardsPage()) setTimeout(start, 100);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(start, 250));
  } else {
    setTimeout(start, 250);
  }
})();
