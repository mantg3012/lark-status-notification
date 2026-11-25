import type { ApprovalConfig, Config } from "./config";
import { todayIn } from "./date";
import { parseForm } from "./form";
import { getInstance, type ApprovalInstance } from "./lark/approval";
import { getTenantAccessToken } from "./lark/auth";
import { createLarkClient, type LarkClient } from "./lark/client";
import { batchClose, batchOpen, resolveStatusId, type OpenUser } from "./lark/status";
import {
  deleteEntry,
  listEntries,
  saveEntry,
  type ScheduleEntry,
  type ScheduleStore,
} from "./schedule";

export type Decision =
  | { action: "open"; statusTitle: string; userId: string; endUnix: number }
  | { action: "schedule"; entry: ScheduleEntry }
  | { action: "close"; statusTitle: string; userId: string }
  | { action: "unschedule" }
  | { action: "skip"; reason: string };

const REVOKED_STATUSES = new Set<string>(["CANCELED", "REVERTED", "DELETED"]);

function isRevoked(inst: ApprovalInstance): boolean {
  return (
    REVOKED_STATUSES.has(inst.status) ||
    (inst as { reverted?: unknown }).reverted === true
  );
}

function summarizeWidgets(formJson: string): { id?: unknown; type?: unknown }[] {
  try {
    const parsed = JSON.parse(formJson);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((w): w is Record<string, unknown> => typeof w === "object" && w !== null)
      .map((w) => ({ id: w.id, type: w.type }));
  } catch {
    return [];
  }
}

export function decide(
  inst: ApprovalInstance,
  appCfg: ApprovalConfig | undefined,
  tz: string,
  now: Date,
): Decision[] {
  if (!appCfg) {
    return [{ action: "skip", reason: "unmapped" }];
  }

  const range = parseForm(inst.form, appCfg, tz);
  if (!range) {
    return [{ action: "skip", reason: "unparsable_form" }];
  }

  const today = todayIn(tz, now);
  const nowSec = Math.floor(now.getTime() / 1000);
  const active = range.startDate <= today && today <= range.endDate && range.endUnix > nowSec;
  const future = range.startDate > today;
  const revoked = isRevoked(inst);

  if (inst.status === "APPROVED" && !revoked) {
    if (active) {
      return [
        {
          action: "open",
          statusTitle: appCfg.statusTitle,
          userId: inst.open_id,
          endUnix: range.endUnix,
        },
      ];
    }
    if (future) {
      return [
        {
          action: "schedule",
          entry: {
            instanceCode: inst.instance_code,
            approvalCode: inst.approval_code,
            statusTitle: appCfg.statusTitle,
            openId: inst.open_id,
            startDate: range.startDate,
            endDate: range.endDate,
            endUnix: range.endUnix,
          },
        },
      ];
    }
    return [{ action: "skip", reason: "outside_range" }];
  }

  if (revoked) {
    const decisions: Decision[] = [{ action: "unschedule" }];
    if (active) {
      decisions.push({
        action: "close",
        statusTitle: appCfg.statusTitle,
        userId: inst.open_id,
      });
    }
    return decisions;
  }

  return [{ action: "skip", reason: `status_${inst.status}` }];
}

export async function connect(cfg: Config): Promise<LarkClient> {
  const token = await getTenantAccessToken(cfg.domain, cfg.appId, cfg.appSecret);
  return createLarkClient(cfg.domain, token);
}

export async function handleInstance(
  client: LarkClient,
  cfg: Config,
  store: ScheduleStore,
  instanceCode: string,
  now: Date = new Date(),
): Promise<Decision[]> {
  const inst = await getInstance(client, instanceCode);
  const appCfg = Object.hasOwn(cfg.approvalMapping, inst.approval_code)
    ? cfg.approvalMapping[inst.approval_code]
    : undefined;
  const decisions = decide(inst, appCfg, cfg.timezone, now);

  for (const d of decisions) {
    let result = "ok";
    let extra: Record<string, unknown> | undefined;

    if (d.action === "open") {
      const statusId = await resolveStatusId(client, d.statusTitle);
      const res = await batchOpen(client, statusId, [
        { user_id: d.userId, end_time: d.endUnix },
      ]);
      result = res[0]?.result ?? "ok";
    } else if (d.action === "close") {
      const statusId = await resolveStatusId(client, d.statusTitle);
      const res = await batchClose(client, statusId, [d.userId]);
      result = res[0]?.result ?? "ok";
    } else if (d.action === "schedule") {
      await saveEntry(store, d.entry);
    } else if (d.action === "unschedule") {
      await deleteEntry(store, inst.instance_code);
    } else if (d.action === "skip") {
      result = d.reason;
      if (d.reason === "unparsable_form") {
        extra = { widgets: summarizeWidgets(inst.form) };
      }
    }

    console.log(
      JSON.stringify({
        action: d.action,
        instance_code: inst.instance_code,
        user: inst.open_id,
        status: inst.status,
        result,
        ...extra,
      }),
    );
  }

  return decisions;
}

export async function runDaily(
  client: LarkClient,
  cfg: Config,
  store: ScheduleStore,
  now: Date = new Date(),
): Promise<{ opened: number; skipped: number; removed: number }> {
  const today = todayIn(cfg.timezone, now);
  const nowSec = Math.floor(now.getTime() / 1000);
  const entries = await listEntries(store);

  let opened = 0;
  let skipped = 0;
  let removed = 0;
  const groups = new Map<string, OpenUser[]>();

  for (const entry of entries) {
    if (entry.endDate < today || entry.endUnix <= nowSec) {
      await deleteEntry(store, entry.instanceCode);
      removed++;
      continue;
    }

    if (entry.startDate <= today) {
      let inst: ApprovalInstance;
      try {
        inst = await getInstance(client, entry.instanceCode);
      } catch (err) {
        console.log(
          JSON.stringify({
            action: "error",
            instance_code: entry.instanceCode,
            message: String(err instanceof Error ? err.message : err),
          }),
        );
        continue;
      }

      if (inst.status === "APPROVED" && !isRevoked(inst)) {
        const list = groups.get(entry.statusTitle) ?? [];
        list.push({ user_id: entry.openId, end_time: entry.endUnix });
        groups.set(entry.statusTitle, list);
      } else {
        skipped++;
      }

      await deleteEntry(store, entry.instanceCode);
    }
  }

  for (const [statusTitle, users] of groups) {
    const statusId = await resolveStatusId(client, statusTitle);
    await batchOpen(client, statusId, users);
    opened += users.length;
  }

  return { opened, skipped, removed };
}
