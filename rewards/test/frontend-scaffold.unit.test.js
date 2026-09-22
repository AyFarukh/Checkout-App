import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const here=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(here,"../..");
for(const file of ["extensions/rewards-account/shopify.extension.toml","extensions/rewards-account/src/RewardsPage.js","extensions/rewards-storefront/shopify.extension.toml","extensions/rewards-storefront/blocks/rewards-program.liquid","extensions/rewards-storefront/blocks/rewards-launcher.liquid"]){test(`FTR-FRONTEND scaffold exists: ${file}`,()=>assert.equal(fs.existsSync(path.join(repo,file)),true));}
