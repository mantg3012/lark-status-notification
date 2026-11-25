import type { LarkClient } from "./client";

export interface SystemStatus {
  system_status_id: string;
  title: string;
  icon_key: string;
  priority: number;
  color?: string;
  i18n_title?: Record<string, string>;
}

export interface CreateStatusInput {
  title: string;
  icon_key: string;
  priority: number;
  color?: string;
  i18n_title?: Record<string, string>;
}

export interface OpenUser {
  user_id: string;
  end_time: number; // Unix seconds
}

export interface StatusResult {
  user_id: string;
  end_time?: number | string; // Lark returns a number
  result: string;
}

interface ListStatusesData {
  items?: SystemStatus[];
  page_token?: string;
  has_more?: boolean;
}

interface CreateStatusData {
  system_status: SystemStatus;
}

interface BatchResultData {
  result_list?: StatusResult[];
}

const PAGE_SIZE = 50;
const BATCH_SIZE = 50;

const statusCache = new Map<string, string>();

export function clearStatusCache(): void {
  statusCache.clear();
}

export async function listSystemStatuses(client: LarkClient): Promise<SystemStatus[]> {
  const all: SystemStatus[] = [];
  let pageToken: string | undefined;

  while (true) {
    const data = await client.request<ListStatusesData>(
      "GET",
      "/personal_settings/v1/system_statuses",
      {
        query: {
          page_size: PAGE_SIZE,
          page_token: pageToken,
        },
      },
    );

    if (Array.isArray(data?.items)) {
      all.push(...data.items);
    }

    if (!data?.has_more || !data.page_token) {
      break;
    }
    pageToken = data.page_token;
  }

  return all;
}

export async function createSystemStatus(
  client: LarkClient,
  input: CreateStatusInput,
): Promise<SystemStatus> {
  const data = await client.request<CreateStatusData>(
    "POST",
    "/personal_settings/v1/system_statuses",
    { body: input },
  );
  return data.system_status;
}

export async function resolveStatusId(client: LarkClient, title: string): Promise<string> {
  const cached = statusCache.get(title);
  if (cached !== undefined) {
    return cached;
  }

  const statuses = await listSystemStatuses(client);
  for (const status of statuses) {
    statusCache.set(status.title, status.system_status_id);
  }

  const resolved = statusCache.get(title);
  if (resolved === undefined) {
    throw new Error(`System status not found: ${title}. Run scripts/setup.ts`);
  }
  return resolved;
}

export async function batchOpen(
  client: LarkClient,
  statusId: string,
  users: OpenUser[],
): Promise<StatusResult[]> {
  if (users.length === 0) {
    return [];
  }

  const results: StatusResult[] = [];
  const path = `/personal_settings/v1/system_statuses/${encodeURIComponent(statusId)}/batch_open`;

  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const chunk = users.slice(i, i + BATCH_SIZE);
    const data = await client.request<BatchResultData>("POST", path, {
      query: { user_id_type: "open_id" },
      body: {
        user_list: chunk.map(({ user_id, end_time }) => ({
          user_id,
          end_time: String(end_time),
        })),
      },
    });
    if (Array.isArray(data?.result_list)) {
      results.push(...data.result_list);
    }
  }

  return results;
}

export async function batchClose(
  client: LarkClient,
  statusId: string,
  userIds: string[],
): Promise<StatusResult[]> {
  if (userIds.length === 0) {
    return [];
  }

  const results: StatusResult[] = [];
  const path = `/personal_settings/v1/system_statuses/${encodeURIComponent(statusId)}/batch_close`;

  for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
    const chunk = userIds.slice(i, i + BATCH_SIZE);
    const data = await client.request<BatchResultData>("POST", path, {
      query: { user_id_type: "open_id" },
      body: { user_list: chunk },
    });
    if (Array.isArray(data?.result_list)) {
      results.push(...data.result_list);
    }
  }

  return results;
}
