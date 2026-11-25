import type { ScheduleStore } from "./schedule";

export interface Env {
  LARK_APP_ID: string;
  LARK_APP_SECRET: string;
  LARK_ENCRYPT_KEY?: string;
  LARK_VERIFICATION_TOKEN: string;
  LARK_DOMAIN: string;
  TIMEZONE: string;
  SCAN_LOOKBACK_DAYS: string;
  APPROVAL_MAPPING: string;
  SCHEDULE: ScheduleStore;
}

export interface ApprovalConfig {
  statusTitle: string;
  startField: string;
  endField: string;
}

export interface Config {
  appId: string;
  appSecret: string;
  encryptKey: string;
  verificationToken: string;
  domain: string;
  timezone: string;
  scanLookbackDays: number;
  approvalMapping: Record<string, ApprovalConfig>;
}

function requireNonEmpty(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing or empty required env variable: ${name}`);
  }
  return value.trim();
}

function parsePositiveInt(value: unknown, name: string): number {
  if (typeof value !== "string" || !/^\d+$/.test(value.trim())) {
    throw new Error(`Invalid positive integer for env variable: ${name}`);
  }
  const parsed = Number(value.trim());
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer for env variable: ${name}`);
  }
  return parsed;
}

function parseApprovalMapping(raw: unknown): Record<string, ApprovalConfig> {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error("Missing or empty required env variable: APPROVAL_MAPPING");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON in env variable: APPROVAL_MAPPING");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("APPROVAL_MAPPING must be a JSON object");
  }

  const result: Record<string, ApprovalConfig> = {};
  for (const [code, entry] of Object.entries(parsed)) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`APPROVAL_MAPPING entry "${code}" must be an object`);
    }
    const obj = entry as Record<string, unknown>;
    const statusTitle = obj.statusTitle;
    const startField = obj.startField;
    const endField = obj.endField;

    if (typeof statusTitle !== "string" || statusTitle.trim() === "") {
      throw new Error(`APPROVAL_MAPPING entry "${code}" is missing non-empty statusTitle`);
    }
    if (typeof startField !== "string" || startField.trim() === "") {
      throw new Error(`APPROVAL_MAPPING entry "${code}" is missing non-empty startField`);
    }
    if (typeof endField !== "string" || endField.trim() === "") {
      throw new Error(`APPROVAL_MAPPING entry "${code}" is missing non-empty endField`);
    }

    result[code] = {
      statusTitle: statusTitle.trim(),
      startField: startField.trim(),
      endField: endField.trim(),
    };
  }

  return result;
}

export function loadConfig(env: Omit<Env, "SCHEDULE">): Config {
  const appId = requireNonEmpty(env.LARK_APP_ID, "LARK_APP_ID");
  const appSecret = requireNonEmpty(env.LARK_APP_SECRET, "LARK_APP_SECRET");
  const verificationToken = requireNonEmpty(env.LARK_VERIFICATION_TOKEN, "LARK_VERIFICATION_TOKEN");
  const domain = requireNonEmpty(env.LARK_DOMAIN, "LARK_DOMAIN").replace(/\/+$/, "");
  const encryptKey = typeof env.LARK_ENCRYPT_KEY === "string" ? env.LARK_ENCRYPT_KEY : "";
  const timezone =
    typeof env.TIMEZONE === "string" && env.TIMEZONE.trim() !== ""
      ? env.TIMEZONE.trim()
      : "Asia/Ho_Chi_Minh";
  const scanLookbackDays = parsePositiveInt(env.SCAN_LOOKBACK_DAYS, "SCAN_LOOKBACK_DAYS");
  const approvalMapping = parseApprovalMapping(env.APPROVAL_MAPPING);

  return {
    appId,
    appSecret,
    encryptKey,
    verificationToken,
    domain,
    timezone,
    scanLookbackDays,
    approvalMapping,
  };
}
