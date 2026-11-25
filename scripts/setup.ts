import { subscribeApproval } from "../src/lark/approval";
import { createLarkClient, LarkApiError } from "../src/lark/client";
import { createSystemStatus, listSystemStatuses, type SystemStatus } from "../src/lark/status";
import { getTenantAccessToken } from "../src/lark/auth";
import { loadScriptEnv } from "./env";

const ICON_KEYS: Record<string, string> = {
  Remote: "GeneralWorkFromHome",
  Off: "GeneralVacation",
};

async function main(): Promise<void> {
  const env = loadScriptEnv({ requireMapping: true });
  const access = await getTenantAccessToken(env.domain, env.appId, env.appSecret);
  const client = createLarkClient(env.domain, access);

  const existing = await listSystemStatuses(client);
  const byTitle = new Map<string, SystemStatus>(existing.map((s) => [s.title, s]));
  let maxPriority = existing.reduce((max, s) => Math.max(max, s.priority), 0);

  let hasFailure = false;
  const uniqueTitles = [...new Set(Object.values(env.approvalMapping).map((c) => c.statusTitle))];

  for (const title of uniqueTitles) {
    if (byTitle.has(title)) {
      continue;
    }

    const iconKey = ICON_KEYS[title];
    if (!iconKey) {
      console.error(`Unknown icon_key for statusTitle "${title}". Supported: ${Object.keys(ICON_KEYS).join(", ")}`);
      hasFailure = true;
      continue;
    }

    const priority = maxPriority + 1;
    const created = await createSystemStatus(client, {
      title,
      icon_key: iconKey,
      priority,
    });
    maxPriority = Math.max(maxPriority, created.priority, priority);
    byTitle.set(title, created);
  }

  for (const approvalCode of Object.keys(env.approvalMapping)) {
    if (approvalCode.startsWith("<")) {
      console.warn(`Skipping placeholder approval_code: ${approvalCode}`);
      continue;
    }

    try {
      await subscribeApproval(client, approvalCode);
    } catch (err) {
      if (err instanceof LarkApiError) {
        // TODO verify already-subscribed error code
        console.error(`Subscribe failed for ${approvalCode}: code=${err.code} msg=${err.msg}`);
        hasFailure = true;
      } else {
        throw err;
      }
    }
  }

  console.log("System statuses:");
  for (const title of uniqueTitles) {
    const id = byTitle.get(title)?.system_status_id ?? "(missing)";
    console.log(`  ${title} -> ${id}`);
  }

  if (hasFailure) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
