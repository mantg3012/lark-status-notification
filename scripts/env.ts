import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { loadConfig, type ApprovalConfig } from "../src/config";

export interface ScriptEnv {
  domain: string;
  appId: string;
  appSecret: string;
  approvalMapping: Record<string, ApprovalConfig>;
}

export function loadScriptEnv(options: { requireMapping: boolean } = { requireMapping: true }): ScriptEnv {
  try {
    // .dev.vars must win over the shell: process.loadEnvFile keeps existing vars, and a shell LARK_APP_ID of another app caused 99991672.
    Object.assign(process.env, parseEnv(readFileSync(".dev.vars", "utf8")));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    if (code !== "ENOENT") {
      console.error(`Failed to load .dev.vars: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }

  const rawMapping = process.env.APPROVAL_MAPPING ?? "";
  const mappingInput = !options.requireMapping && rawMapping.trim() === "" ? "{}" : rawMapping;

  try {
    const cfg = loadConfig({
      LARK_APP_ID: process.env.LARK_APP_ID ?? "",
      LARK_APP_SECRET: process.env.LARK_APP_SECRET ?? "",
      LARK_ENCRYPT_KEY: process.env.LARK_ENCRYPT_KEY,
      LARK_VERIFICATION_TOKEN: "unused",
      LARK_DOMAIN: process.env.LARK_DOMAIN?.trim() || "https://open.larksuite.com",
      TIMEZONE: process.env.TIMEZONE ?? "Asia/Ho_Chi_Minh",
      SCAN_LOOKBACK_DAYS: "1",
      APPROVAL_MAPPING: mappingInput,
    });

    return {
      domain: cfg.domain,
      appId: cfg.appId,
      appSecret: cfg.appSecret,
      approvalMapping: cfg.approvalMapping,
    };
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
