import { createLarkClient } from "../src/lark/client";
import { batchOpen, resolveStatusId } from "../src/lark/status";
import { getTenantAccessToken } from "../src/lark/auth";
import { loadScriptEnv } from "./env";

function printUsage(): void {
  console.error("Usage: npm run try-open -- <statusTitle> <open_id> [minutes=10]");
}

async function main(): Promise<void> {
  const [title, userId, minutesRaw] = process.argv.slice(2);
  if (!title || !userId) {
    printUsage();
    process.exit(1);
  }

  let minutes = 10;
  if (minutesRaw !== undefined) {
    if (!/^\d+$/.test(minutesRaw) || Number(minutesRaw) <= 0) {
      printUsage();
      console.error("minutes must be a positive integer");
      process.exit(1);
    }
    minutes = Number(minutesRaw);
  }

  const env = loadScriptEnv({ requireMapping: false });
  const access = await getTenantAccessToken(env.domain, env.appId, env.appSecret);
  const client = createLarkClient(env.domain, access);

  const statusId = await resolveStatusId(client, title);
  const endTime = Math.floor(Date.now() / 1000) + minutes * 60;
  const resultList = await batchOpen(client, statusId, [{ user_id: userId, end_time: endTime }]);

  console.log(JSON.stringify(resultList, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
