import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { ReferralEntitlement } from "../src/models/ReferralEntitlement.js";
import { processReferralMaintenance } from "../src/services/referral-live.service.js";

test("gift reconciliation serializes opposite actions and recovers orphaned creation", { skip: !process.env.MONGODB_URI }, async () => {
  await mongoose.connect(process.env.MONGODB_URI, { dbName: (process.env.MONGODB_DB_NAME || "ftr_test") + "_referral_maintenance" });
  const shop = `maintenance-${Date.now()}.myshopify.com`, customerId = "gid://shopify/Customer/900";
  try {
    for (const initial of [true, false]) {
      const e = await ReferralEntitlement.create({ shop, customerId, milestoneId: `gift-${initial}`, snapshot: { kind: "PRODUCT", threshold: 3 },
        qualified: initial, discountId: `test-discount-${initial}`, discountCode: `FTR-GIFT-${initial}`, syncAction: initial ? "ENABLE" : "DISABLE" });
      let release, started;
      const wait = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { started = resolve; });
      const states = [];
      const setActive = async (_shop, _id, active) => { if (active === initial) { started(); await wait; } states.push(active); };
      const first = processReferralMaintenance(1, { setActive });
      await entered;
      await ReferralEntitlement.updateOne({ _id: e._id }, { $set: { qualified: !initial, syncAction: initial ? "DISABLE" : "ENABLE" } });
      await processReferralMaintenance(1, { setActive });
      release(); await first; await processReferralMaintenance(1, { setActive });
      assert.equal(states.at(-1), !initial, "the latest action must win after a delayed opposite mutation");
      assert.equal((await ReferralEntitlement.findById(e._id)).syncAction, null);
    }
    await ReferralEntitlement.create({ shop, customerId, milestoneId: "orphan", snapshot: { kind: "PRODUCT", threshold: 5 },
      qualified: false, discountCode: "FTR-GIFT-ORPHAN", syncAction: "DISABLE", issueLockUntil: new Date(0) });
    let disabled = false;
    await processReferralMaintenance(1, { findDiscount: async () => ({ discountId: "recovered-shopify-id" }),
      setActive: async (_shop, id, active) => { assert.equal(id, "recovered-shopify-id"); assert.equal(active, false); disabled = true; } });
    assert.equal(disabled, true);
    const recovered = await ReferralEntitlement.findOne({ shop, milestoneId: "orphan" });
    assert.equal(recovered.discountId, "recovered-shopify-id"); assert.equal(recovered.syncAction, null);
  } finally { await ReferralEntitlement.deleteMany({ shop }); await mongoose.disconnect(); }
});
