# Lark Status Sync — Cloudflare Worker

Spec để implement bằng Claude Code. Tự động bật/tắt system status **"Remote"** / **"Off"** trên Lark khi đơn tương ứng trên Lark Approval được duyệt.

> ⚠️ Các endpoint, field và format event dưới đây được viết theo hiểu biết về Lark/Feishu Open API, **chưa được verify trên tenant thật**. Trước khi code mỗi phần, đối chiếu với docs chính thức tại https://open.larksuite.com/document và test bằng curl (xem Phase 0).

---

## 1. Mục tiêu

- Khi đơn **Remote** hoặc **Off** được duyệt và ngày bắt đầu là **hôm nay** → bật status ngay (qua webhook).
- Với đơn cho **ngày trong tương lai** → cron mỗi sáng (8:00 giờ VN) bật status cho những ai có lịch hôm đó.
- Khi đơn bị **hủy / thu hồi** → tắt status nếu đang trong khoảng thời gian của đơn.
- Status tự hết hạn vào cuối ngày kết thúc của đơn (dùng `end_time` của API, không cần job tắt riêng).
- Không dùng database: mọi trạng thái đều suy ra từ Lark Approval.

## 2. Ngoài phạm vi (v1)

- Đơn nửa ngày / theo giờ: v1 coi như cả ngày (ghi chú TODO).
- Đơn nhiều ngày không liên tục.
- UI quản trị.

## 3. Kiến trúc

```
Lark Approval ──(event approval_instance)──▶ Worker fetch handler ──▶ Lark Status API
                                                   ▲
Cloudflare Cron (0 1 * * * UTC = 8:00 VN) ──▶ Worker scheduled handler
                                                   │
                                                   └─ quét đơn APPROVED có ngày hôm nay ──▶ batch_open
```

- Runtime: Cloudflare Workers, TypeScript.
- Không phụ thuộc thư viện ngoài cho crypto: dùng Web Crypto (`crypto.subtle`).
- Không lưu `tenant_access_token`: lấy mới mỗi lần chạy (token sống ~2 giờ, chi phí 1 request).

## 4. Cấu trúc project

```
lark-status-sync/
├── wrangler.toml
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts            # export default { fetch, scheduled }
│   ├── config.ts           # đọc env, parse APPROVAL_MAPPING
│   ├── sync.ts             # logic chính: xử lý 1 instance, quét hôm nay
│   ├── date.ts             # xử lý timezone Asia/Ho_Chi_Minh, ngày hôm nay, end-of-day
│   └── lark/
│       ├── client.ts       # fetch wrapper: domain, token, xử lý lỗi code != 0, retry nhẹ
│       ├── auth.ts         # tenant_access_token
│       ├── approval.ts     # list instances, get instance, subscribe, parse form
│       ├── status.ts       # list/create system status, batch_open, batch_close
│       └── event.ts        # decrypt, url_verification, verify token
├── scripts/
│   └── setup.ts            # chạy 1 lần bằng tsx: tạo status, subscribe approval
└── test/
    ├── event.test.ts       # decrypt + challenge
    ├── form.test.ts        # parse form → {start, end}
    └── sync.test.ts        # logic quyết định bật/tắt (mock Lark client)
```

## 5. Cấu hình

### Secrets (`wrangler secret put <NAME>`)

| Tên | Mô tả |
|---|---|
| `LARK_APP_ID` | App ID của Custom App |
| `LARK_APP_SECRET` | App Secret |
| `LARK_ENCRYPT_KEY` | Encrypt Key trong Event Subscription (để trống nếu không bật mã hóa) |
| `LARK_VERIFICATION_TOKEN` | Verification Token để kiểm tra event đến từ Lark |

### Vars (`wrangler.toml`)

```toml
name = "lark-status-sync"
main = "src/index.ts"
compatibility_date = "2026-11-01"

[triggers]
crons = ["0 1 * * *"]   # 8:00 Asia/Ho_Chi_Minh

[vars]
LARK_DOMAIN = "https://open.larksuite.com"
TIMEZONE = "Asia/Ho_Chi_Minh"
SCAN_LOOKBACK_DAYS = "60"
# approval_code → cấu hình
APPROVAL_MAPPING = '''
{
  "<APPROVAL_CODE_REMOTE>": { "statusTitle": "Remote", "startField": "<widget_id>", "endField": "<widget_id>" },
  "<APPROVAL_CODE_OFF>":    { "statusTitle": "Off",    "startField": "<widget_id>", "endField": "<widget_id>" }
}
'''
```

- `system_status_id` không hard-code: lúc runtime gọi list status rồi tra theo `title` (cache trong biến module là đủ).
- Nếu form dùng widget khoảng ngày (date interval) hoặc widget nghỉ phép có sẵn thì `startField` = `endField` = id của widget đó; parser tự nhận dạng.

## 6. Lark API sử dụng

Base URL: `LARK_DOMAIN + /open-apis`. Mọi response có dạng `{ code, msg, data }`; `code != 0` là lỗi → throw kèm `code` và `msg`.

| Mục đích | Method & path | Ghi chú |
|---|---|---|
| Lấy token | `POST /auth/v3/tenant_access_token/internal` | body `{ app_id, app_secret }` |
| List status | `GET /personal_settings/v1/system_statuses` | phân trang `page_size`, `page_token` |
| Tạo status | `POST /personal_settings/v1/system_statuses` | `title` (1–20 ký tự, không trùng), `icon_key`, `priority` (không trùng), `i18n_title`, `color` |
| Bật status | `POST /personal_settings/v1/system_statuses/{id}/batch_open?user_id_type=open_id` | body `{ user_list: [{ user_id, end_time }] }`, tối đa 50 user/lần |
| Tắt status | `POST /personal_settings/v1/system_statuses/{id}/batch_close?user_id_type=open_id` | body `{ user_list: [user_id] }`, tối đa 50 |
| Subscribe approval | `POST /approval/v4/approvals/{approval_code}/subscribe` | chạy 1 lần trong `scripts/setup.ts` |
| List instance | `GET /approval/v4/instances?approval_code=&start_time=&end_time=` | thời gian dạng ms, lọc theo **thời điểm tạo đơn**; phân trang |
| Chi tiết instance | `GET /approval/v4/instances/{instance_code}` | trả `status`, `open_id`, `form` (chuỗi JSON) |

Cần verify:
- Kiểu dữ liệu `end_time` trong `batch_open` (Unix giây, dạng string hay number).
- `user_id_type` mặc định của 2 API status.
- Lark quốc tế có mở nhóm API `personal_settings` cho tenant không (lỗi `2005007` = tenant không có quyền).

### Quyền (scopes) cần xin cho app

- Cập nhật system status: `personal_settings:status:system_status_update`
- Đọc Approval (instance + subscribe): tìm scope tương ứng trong Developer Console
- Subscribe event `approval_instance` trong mục Event Subscription

## 7. Xử lý webhook (`fetch`)

Chỉ nhận `POST /lark/events`. Mọi path khác trả về 404.

1. Đọc body JSON.
2. Nếu có field `encrypt` → giải mã:
   - `key = SHA-256(LARK_ENCRYPT_KEY)` (32 byte)
   - `buf = base64decode(encrypt)`; `iv = buf[0..16]`, `cipher = buf[16..]`
   - AES-256-CBC, PKCS7 → JSON
3. Nếu `type == "url_verification"` → kiểm tra `token`, trả về `{ "challenge": <challenge> }`.
4. Kiểm tra `token` (event v1) hoặc `header.token` (event v2) khớp `LARK_VERIFICATION_TOKEN`. Không khớp → 401.
5. Nếu là event `approval_instance` và `approval_code` có trong `APPROVAL_MAPPING`:
   - Dùng `ctx.waitUntil(handleInstance(instance_code))` rồi **trả 200 ngay**, vì Lark retry nếu phản hồi chậm.
6. Các event khác → trả 200, bỏ qua.

Cần verify với docs: event Approval là format v1 (`event.type`, `event.status`, `event.instance_code`) hay v2 (`header.event_type`), và Lark có gửi kèm header chữ ký `X-Lark-Signature` hay không. Nếu có, verify thêm `sha256(timestamp + nonce + encrypt_key + body)`.

## 8. Logic chính (`sync.ts`)

### `handleInstance(instanceCode)`

```
inst = getInstance(instanceCode)
cfg  = APPROVAL_MAPPING[inst.approval_code]  (không có → return)
{ start, end } = parseForm(inst.form, cfg)  → ngày dạng YYYY-MM-DD theo TIMEZONE
today = todayIn(TIMEZONE)
statusId = resolveStatusId(cfg.statusTitle)

if inst.status == "APPROVED" and start <= today <= end:
    batchOpen(statusId, [{ user_id: inst.open_id, end_time: endOfDay(end) }])
elif inst.status in ["CANCELED", "REVERTED", "DELETED"] and start <= today <= end:
    batchClose(statusId, [inst.open_id])
else:
    log & return   (ngày tương lai sẽ do cron xử lý)
```

### `scanToday()` (cron)

```
for approval_code in APPROVAL_MAPPING:
    codes = listInstances(approval_code, created từ (now - SCAN_LOOKBACK_DAYS) đến now)
    for code in codes:
        inst = getInstance(code)
        nếu APPROVED và start <= today <= end → gom vào nhóm theo statusId
batchOpen theo từng nhóm, chia lô 50 user
```

- Gọi `batch_open` lặp lại cho cùng user là chấp nhận được (idempotent), không cần dedupe phức tạp.
- `endOfDay(date)` = 23:59:59 ngày đó theo `TIMEZONE`, đổi sang Unix giây.
- Giới hạn gọi API ~100 lần/phút: nếu số instance lớn, gọi tuần tự hoặc concurrency ≤ 5. Nếu gặp lỗi rate limit thì chờ rồi thử lại.

### `parseForm(formJson, cfg)`

`form` là chuỗi JSON dạng mảng widget `[{ id, type, value, ... }]`. Hỗ trợ:
- `date`: `value` là chuỗi thời gian ISO → lấy phần ngày theo `TIMEZONE`
- `dateInterval`: `value = { start, end }`
- Widget nghỉ phép có sẵn (leave group): `value` chứa `start` / `end`

Không parse được → log `instance_code` cùng dữ liệu form thô rồi bỏ qua, không throw làm hỏng cả batch.

## 9. Script setup (`scripts/setup.ts`, chạy 1 lần)

1. Lấy token.
2. List system status; status nào trong `APPROVAL_MAPPING` chưa có thì tạo (ví dụ "Remote", "Off"), chọn `icon_key` và `priority` chưa bị dùng.
3. Subscribe từng `approval_code`.
4. In ra `system_status_id` để kiểm tra.

Chạy: `npx tsx scripts/setup.ts` với env lấy từ `.dev.vars`.

## 10. Logging

- `console.log` dạng JSON 1 dòng: `{ action, instance_code, user, status, result }`.
- Xem log realtime: `wrangler tail`. Có thể bật Workers Logs trong dashboard.
- **Không** log `app_secret`, token hay body event chưa giải mã.

## 11. Kế hoạch triển khai

### Phase 0: Verify (làm tay, trước khi code)
- [ ] Hỏi admin: Admin Console có sẵn tùy chọn đồng bộ status với đơn nghỉ không? Nếu có, dừng project.
- [ ] Tạo Custom App, xin scopes, admin duyệt publish.
- [ ] `curl` lấy token, sau đó `GET /personal_settings/v1/system_statuses` → phải trả `code: 0`.
- [ ] Lấy `approval_code` của form Remote và form Off; gọi `GET instance` 1 đơn mẫu để xem cấu trúc `form`, ghi lại widget id.

### Phase 1: Khung project
- [ ] `npm create cloudflare@latest` (Worker, TypeScript), thêm vitest.
- [ ] `config.ts`, `date.ts`, `lark/client.ts`, `lark/auth.ts`.

### Phase 2: Status + setup
- [ ] `lark/status.ts`, `scripts/setup.ts`; chạy setup và kiểm tra status mới xuất hiện trong Lark.
- [ ] Test tay: `batch_open` cho chính mình với `end_time` sau 10 phút → status hiện lên rồi tự tắt.

### Phase 3: Approval + cron
- [ ] `lark/approval.ts`, `parseForm`, `scanToday`.
- [ ] Test local: `wrangler dev --test-scheduled`, gọi `/__scheduled`.

### Phase 4: Webhook
- [ ] `lark/event.ts` (decrypt + challenge + verify token), route `/lark/events`.
- [ ] `wrangler deploy`, dán URL vào Event Subscription, Lark phải verify URL thành công.
- [ ] Gửi một đơn test có ngày hôm nay → duyệt → status bật trong vài giây; hủy đơn → status tắt.

### Phase 5: Hoàn thiện
- [ ] Unit test cho decrypt, parseForm, logic quyết định trong sync.
- [ ] README ngắn: cách setup, secrets, cách xem log.

## 12. Tiêu chí hoàn thành

- Đơn có ngày bắt đầu hôm nay được duyệt → status bật trong < 1 phút.
- Đơn cho ngày mai được duyệt → không bật ngay; 8:00 sáng mai status bật.
- Status tự tắt sau ngày kết thúc.
- Hủy đơn đang có hiệu lực → status tắt.
- Event giả (sai token) → 401, không gọi API.
- Không lộ secret trong log hay repo.

## 13. Câu hỏi cần trả lời trước khi code

1. Remote và Off là 2 form riêng hay 1 form có field chọn loại? (Nếu là 1 form → mapping thêm `typeField` cùng giá trị tương ứng.)
2. Form dùng widget gì cho ngày: date, date interval hay widget nghỉ phép có sẵn?
3. Có đơn nửa ngày không?
4. Tài khoản Cloudflare dùng của công ty hay cá nhân?
