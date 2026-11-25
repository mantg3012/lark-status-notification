export interface ScheduleStore {
  put(key: string, value: string, opts?: { expiration?: number; metadata?: unknown }): Promise<void>;
  delete(key: string): Promise<void>;
  list(opts?: { prefix?: string; cursor?: string }): Promise<{
    keys: { name: string; metadata?: unknown }[];
    list_complete: boolean;
    cursor?: string;
  }>;
}

export interface ScheduleEntry {
  instanceCode: string;
  approvalCode: string;
  statusTitle: string;
  openId: string;
  startDate: string;
  endDate: string;
  endUnix: number;
}

export const KEY_PREFIX = "inst:";

export function scheduleKey(instanceCode: string): string {
  return KEY_PREFIX + instanceCode;
}

export function toKvRecord(e: ScheduleEntry): {
  key: string;
  value: string;
  metadata: ScheduleEntry;
  expiration: number;
} {
  return {
    key: scheduleKey(e.instanceCode),
    value: "1",
    metadata: e,
    expiration: e.endUnix + 86400,
  };
}

export async function saveEntry(store: ScheduleStore, e: ScheduleEntry): Promise<void> {
  const { key, value, metadata, expiration } = toKvRecord(e);
  await store.put(key, value, { expiration, metadata });
}

export async function deleteEntry(store: ScheduleStore, instanceCode: string): Promise<void> {
  await store.delete(scheduleKey(instanceCode));
}

function isValidScheduleEntry(meta: unknown): meta is ScheduleEntry {
  if (typeof meta !== "object" || meta === null) {
    return false;
  }
  const m = meta as Record<string, unknown>;
  return (
    typeof m.instanceCode === "string" &&
    m.instanceCode !== "" &&
    typeof m.approvalCode === "string" &&
    m.approvalCode !== "" &&
    typeof m.statusTitle === "string" &&
    m.statusTitle !== "" &&
    typeof m.openId === "string" &&
    m.openId !== "" &&
    typeof m.startDate === "string" &&
    m.startDate !== "" &&
    typeof m.endDate === "string" &&
    m.endDate !== "" &&
    typeof m.endUnix === "number" &&
    Number.isFinite(m.endUnix)
  );
}

export async function listEntries(store: ScheduleStore): Promise<ScheduleEntry[]> {
  const entries: ScheduleEntry[] = [];
  let cursor: string | undefined;

  while (true) {
    const page = await store.list({ prefix: KEY_PREFIX, cursor });
    for (const item of page.keys) {
      if (isValidScheduleEntry(item.metadata)) {
        entries.push(item.metadata);
      }
    }

    if (page.list_complete || !page.cursor) {
      break;
    }
    cursor = page.cursor;
  }

  return entries;
}
