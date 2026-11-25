import { describe, expect, it } from "vitest";
import {
  deleteEntry,
  KEY_PREFIX,
  listEntries,
  saveEntry,
  scheduleKey,
  type ScheduleEntry,
  type ScheduleStore,
} from "../src/schedule";

interface StoredRecord {
  value: string;
  expiration?: number;
  metadata?: unknown;
}

function createFakeStore(pageSize = 100): {
  store: ScheduleStore;
  data: Map<string, StoredRecord>;
} {
  const data = new Map<string, StoredRecord>();

  const store: ScheduleStore = {
    async put(key, value, opts) {
      data.set(key, {
        value,
        expiration: opts?.expiration,
        metadata: opts?.metadata,
      });
    },
    async delete(key) {
      data.delete(key);
    },
    async list(opts) {
      const prefix = opts?.prefix ?? "";
      const matching = [...data.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([name, rec]) => ({ name, metadata: rec.metadata }));

      const offset = opts?.cursor ? Number(opts.cursor) : 0;
      const slice = matching.slice(offset, offset + pageSize);
      const nextOffset = offset + slice.length;
      const listComplete = nextOffset >= matching.length;

      return {
        keys: slice,
        list_complete: listComplete,
        cursor: listComplete ? undefined : String(nextOffset),
      };
    },
  };

  return { store, data };
}

function makeEntry(code: string, endUnix = 1795798800): ScheduleEntry {
  return {
    instanceCode: code,
    approvalCode: "72A5FBFF-7F4C-4233-A0E5-E421E1E6276D",
    statusTitle: "Off",
    openId: `ou_${code}`,
    startDate: "2026-11-27",
    endDate: "2026-11-27",
    endUnix,
  };
}

describe("schedule store", () => {
  it("saveEntry stores full metadata and expiration = endUnix + 86400", async () => {
    const { store, data } = createFakeStore();
    const entry = makeEntry("INST_1", 1795798800);

    await saveEntry(store, entry);

    const raw = data.get(scheduleKey("INST_1"));
    expect(raw).toEqual({
      value: "1",
      expiration: 1795798800 + 86400,
      metadata: entry,
    });

    const listed = await store.list({ prefix: KEY_PREFIX });
    expect(listed.keys).toEqual([{ name: "inst:INST_1", metadata: entry }]);
  });

  it("listEntries merges 2 pages, skips keys with missing metadata, and deleteEntry removes key", async () => {
    const { store, data } = createFakeStore(2);
    const e1 = makeEntry("INST_1");
    const e2 = makeEntry("INST_2");
    const e3 = makeEntry("INST_3");

    await saveEntry(store, e1);
    await saveEntry(store, e2);
    data.set("inst:BAD_META", { value: "1", metadata: { instanceCode: "BAD_META" } });
    data.set("other:IGNORED", { value: "1", metadata: e3 });
    await saveEntry(store, e3);

    const all = await listEntries(store);
    expect(all).toEqual([e1, e2, e3]);

    await deleteEntry(store, "INST_2");
    expect(data.has("inst:INST_2")).toBe(false);
    expect(await listEntries(store)).toEqual([e1, e3]);
  });
});
