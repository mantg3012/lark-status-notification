import { loadConfig, type Env } from "./config";
import { EventAuthError, EventFormatError, parseLarkEvent } from "./lark/event";
import { connect, handleInstance, runDaily } from "./sync";

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== "/lark/events" || req.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }

    const cfg = loadConfig(env);
    const raw = await req.text();

    let ev;
    try {
      ev = await parseLarkEvent(raw, req.headers, {
        encryptKey: cfg.encryptKey,
        verificationToken: cfg.verificationToken,
      });
    } catch (err) {
      if (err instanceof EventAuthError) {
        return new Response("Unauthorized", { status: 401 });
      }
      if (err instanceof EventFormatError) {
        return new Response("Bad request", { status: 400 });
      }
      throw err;
    }

    if (ev.kind === "challenge") {
      return Response.json({ challenge: ev.challenge });
    }

    if (ev.kind === "approval_instance" && Object.hasOwn(cfg.approvalMapping, ev.approvalCode)) {
      console.log(
        JSON.stringify({
          action: "event_received",
          instance_code: ev.instanceCode,
          approval_code: ev.approvalCode,
          status: ev.status,
        }),
      );
      ctx.waitUntil(
        connect(cfg)
          .then((c) => handleInstance(c, cfg, env.SCHEDULE, ev.instanceCode))
          .catch((e) =>
            console.log(
              JSON.stringify({
                action: "error",
                instance_code: ev.instanceCode,
                message: String(e instanceof Error ? e.message : e),
              }),
            ),
          ),
      );
    }

    return Response.json({});
  },
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    const cfg = loadConfig(env);
    const client = await connect(cfg);
    const result = await runDaily(client, cfg, env.SCHEDULE);
    console.log(JSON.stringify({ action: "daily", ...result }));
  },
} satisfies ExportedHandler<Env>;
