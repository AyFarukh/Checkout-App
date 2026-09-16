/** @jsxImportSource preact */
import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useCallback, useEffect, useMemo, useState} from 'preact/hooks';

export default async () => render(<RewardsPage />, document.body);

function RewardsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const settings = shopify.settings?.value || {};
  const apiBase = String(settings.api_base_url || '').replace(/\/$/, '');
  const title = settings.page_title || 'My rewards';
  const load = useCallback(async () => {
    if (!apiBase) { setError('Rewards are being configured. Please check back soon.'); return; }
    try { setError(''); const token = await shopify.sessionToken.get(); const response = await fetch(`${apiBase}/api/customer/me`, {headers: {Authorization: `Bearer ${token}`}}); if (!response.ok) throw new Error('Unable to load your rewards right now.'); setData(await response.json()); }
    catch (e) { setError(e.message || 'Unable to load rewards.'); }
  }, [apiBase]);
  useEffect(() => { load(); }, [load]);
  const redeem = async (reward) => {
    try { setBusy(reward._id); setError(''); const token = await shopify.sessionToken.get(); const key = `account:${reward._id}:${Date.now()}:${Math.random().toString(36).slice(2)}`; const response = await fetch(`${apiBase}/api/customer/redemptions/reserve`, {method: 'POST', headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': key}, body: JSON.stringify({rewardId: reward._id})}); const result = await response.json(); if (!response.ok) throw new Error(result?.error?.message || result?.error || 'Reward could not be redeemed.'); shopify.toast?.show?.('Reward reserved successfully'); await load(); }
    catch (e) { setError(e.message || 'Reward could not be redeemed.'); } finally { setBusy(''); }
  };
  const customer = data?.customer; const points = Number(customer?.pointsBalance || 0); const next = useMemo(() => (data?.rewards || []).find((r) => Number(r.pointsCost) > points), [data, points]); const progress = next ? Math.min(100, Math.round((points / Number(next.pointsCost || 1)) * 100)) : 100;
  return <s-page heading={title}><s-stack direction="block" gap="base">{error && <s-banner tone="critical">{error}</s-banner>}{!data && !error && <s-section><s-stack direction="block" gap="small"><s-heading>Loading your rewards</s-heading><s-spinner /></s-stack></s-section>}{data && <><s-section heading="Your balance"><s-stack direction="block" gap="small"><s-heading>{points.toLocaleString()} points</s-heading><s-text>{Number(customer.pointsReserved || 0).toLocaleString()} points currently reserved</s-text><s-progress value={progress} max={100} /><s-text>{next ? `${Math.max(0, Number(next.pointsCost) - points).toLocaleString()} more points until ${next.name}` : 'You can unlock every available reward.'}</s-text></s-stack></s-section><s-section heading="Available rewards"><s-stack direction="block" gap="base">{(data.rewards || []).length === 0 && <s-text>No rewards are available yet.</s-text>}{(data.rewards || []).map((reward) => <s-box key={reward._id} padding="base" border="base" borderRadius="base"><s-stack direction="block" gap="small"><s-heading>{reward.name}</s-heading><s-text>{Number(reward.pointsCost).toLocaleString()} points</s-text>{reward.minimumSpend > 0 && <s-text>Minimum spend: {reward.minimumSpend}</s-text>}<s-button disabled={points < reward.pointsCost || Boolean(busy)} loading={busy === reward._id} onClick={() => redeem(reward)}>{points >= reward.pointsCost ? 'Redeem reward' : 'Keep earning'}</s-button></s-stack></s-box>)}</s-stack></s-section><s-section heading="Ways to earn"><s-stack direction="block" gap="small">{(data.rules || []).map((rule) => <s-box key={rule._id} padding="small"><s-stack direction="inline" gap="small"><s-text type="strong">{rule.name}</s-text><s-text>{rule.pointsPerDollar ? `${rule.pointsPerDollar} points per $1` : rule.points ? `+${rule.points} points` : rule.multiplier ? `${rule.multiplier}× points` : 'Earn points'}</s-text></s-stack></s-box>)}</s-stack></s-section><s-section heading="Recent activity"><s-stack direction="block" gap="small">{(data.activity || []).length === 0 && <s-text>Your points activity will appear here.</s-text>}{(data.activity || []).slice(0, 12).map((item) => <s-box key={item._id} padding="small"><s-stack direction="inline" gap="small"><s-text>{item.reason || item.source}</s-text><s-text type="strong">{item.points > 0 ? '+' : ''}{item.points} points</s-text></s-stack></s-box>)}</s-stack></s-section></>}</s-stack></s-page>;
}
