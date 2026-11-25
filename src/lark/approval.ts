import type { LarkClient } from "./client";

export type InstanceStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "CANCELED"
  | "DELETED"
  | "REVERTED"
  | (string & {});

export interface ApprovalInstance {
  instance_code: string;
  approval_code: string;
  status: InstanceStatus;
  open_id: string;
  form: string;
  start_time?: string;
  end_time?: string;
}

interface ListInstancesData {
  instance_code_list?: string[];
  page_token?: string;
  has_more?: boolean;
}

const PAGE_SIZE = 100;

export async function listInstanceCodes(
  client: LarkClient,
  approvalCode: string,
  startMs: number,
  endMs: number,
): Promise<string[]> {
  const all: string[] = [];
  let pageToken: string | undefined;

  while (true) {
    const data = await client.request<ListInstancesData>(
      "GET",
      "/approval/v4/instances",
      {
        query: {
          approval_code: approvalCode,
          start_time: String(startMs),
          end_time: String(endMs),
          page_size: PAGE_SIZE,
          page_token: pageToken,
        },
      },
    );

    if (Array.isArray(data?.instance_code_list)) {
      all.push(...data.instance_code_list);
    }

    if (!data?.has_more || !data.page_token) {
      break;
    }
    pageToken = data.page_token;
  }

  return all;
}

export async function getInstance(
  client: LarkClient,
  instanceCode: string,
): Promise<ApprovalInstance> {
  const data = await client.request<Partial<ApprovalInstance>>(
    "GET",
    `/approval/v4/instances/${encodeURIComponent(instanceCode)}`,
  );

  return {
    ...(data as ApprovalInstance),
    instance_code: data?.instance_code || instanceCode,
  };
}

export async function subscribeApproval(
  client: LarkClient,
  approvalCode: string,
): Promise<void> {
  await client.request<unknown>(
    "POST",
    `/approval/v4/approvals/${encodeURIComponent(approvalCode)}/subscribe`,
    { body: {} },
  );
}
