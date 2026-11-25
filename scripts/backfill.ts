import { writeFileSync } from "node:fs";
import { getInstance, listInstanceCodes } from "../src/lark/approval";
import { createLarkClient } from "../src/lark/client";
import { toKvRecord } from "../src/schedule";
import { decide } from "../src/sync";
import { getTenantAccessToken } from "../src/lark/auth";
import { loadScriptEnv } from "./env";

async function main(): Promise<void> {
  const env = loadScriptEnv({ requireMapping: true });
  const token = await getTenantAccessToken(env.domain, env.appId, env.appSecret);
  const client = createLarkClient(env.domain, token);

  const tz = process.env.TIMEZONE?.trim() || "Asia/Ho_Chi_Minh";
  const days = Number(process.env.SCAN_LOOKBACK_DAYS || "60");
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error(`Invalid SCAN_LOOKBACK_DAYS: ${process.env.SCAN_LOOKBACK_DAYS}`);
  }

  const now = new Date();
  const endMs = now.getTime();
  const startMs = endMs - days * 86400000;

  let scanned = 0;
  let activeCount = 0;
  const records: ReturnType<typeof toKvRecord>[] = [];

  for (const [approvalCode, appCfg] of Object.entries(env.approvalMapping)) {
    if (approvalCode.startsWith("<")) {
      continue;
    }

    const codes = await listInstanceCodes(client, approvalCode, startMs, endMs);
    for (const code of codes) {
      const inst = await getInstance(client, code);
      scanned++;

      const decisions = decide(inst, appCfg, tz, now);
      for (const d of decisions) {
        if (d.action === "schedule") {
          records.push(toKvRecord(d.entry));
        } else if (d.action === "open") {
          activeCount++;
        }
      }
    }
  }

  writeFileSync("backfill-kv.json", JSON.stringify(records, null, 2) + "\n", "utf8");

  console.log(`Scanned ${scanned} instances.`);
  console.log(`Wrote ${records.length} scheduled entries to backfill-kv.json.`);
  if (activeCount > 0) {
    console.log(
      `Note: ${activeCount} instance(s) are currently active today (not opened by backfill; this script is read-only).`,
    );
  }
  console.log("Upload to KV with:");
  console.log("  npx wrangler kv bulk put backfill-kv.json --binding SCHEDULE --remote");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
