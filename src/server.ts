import express from "express";
import { createHash, timingSafeEqual } from 'node:crypto';
import { pool, migrate } from './db';
import { admin, authorized } from './admin/routes';
import { receive } from './customer-service/collaboration';
import { createClient } from "redis";
import { generateCaption, CaptionRequest } from "./caption";
import {
  CustomerServiceRequest,
  generateCustomerServiceReply,
} from "./customer-service/agent";

const app = express();

// Verification only: never log query parameters or the configured secret.
app.get('/webhooks/instagram', (req, res) => {
  const expected = process.env.META_INSTAGRAM_VERIFY_TOKEN;
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (req.query['hub.mode'] !== 'subscribe' || !expected ||
      typeof token !== 'string' || typeof challenge !== 'string') {
    res.sendStatus(403);
    return;
  }
  const digest = (value: string) => createHash('sha256').update(value).digest();
  if (!timingSafeEqual(digest(token), digest(expected))) {
    res.sendStatus(403);
    return;
  }
  res.status(200).type('text/plain').send(challenge);
});

// Acknowledgement scaffold only. No ingestion, persistence, or outbound messages.
// Register before JSON parsing so acknowledgement does not depend on payload parsing.
app.post('/webhooks/instagram', (_req, res) => {
  res.status(200).type('text/plain').send('EVENT_RECEIVED');
});

app.use(express.json());
app.use('/admin', admin);

const port = Number(process.env.PORT || 8080);


const redis = createClient({
  url: process.env.REDIS_URL,
});

redis.on("error", (err) => {
  console.error("Redis error:", err);
});

/*
 * Basic health check
 */
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "vivid-novel-ai",
  });
});

/*
 * PostgreSQL connection test
 */
app.get("/db-test", async (_req, res) => {
  try {
    const result = await pool.query("SELECT 1 AS connected");

    res.json({
      status: "ok",
      database: result.rows[0].connected === 1,
    });
  } catch (error) {
    console.error("Database connection failed:", error);

    res.status(500).json({
      status: "error",
      database: false,
    });
  }
});

/*
 * Redis connection test
 */
app.get("/redis-test", async (_req, res) => {
  try {
    if (!redis.isOpen) {
      await redis.connect();
    }

    await redis.set("vivid-novel-test", "working");

    const value = await redis.get("vivid-novel-test");

    res.json({
      status: "ok",
      redis: value === "working",
    });
  } catch (error) {
    console.error("Redis connection failed:", error);

    res.status(500).json({
      status: "error",
      redis: false,
    });
  }
});

/*
 * AI Instagram caption generator
 *
 * POST /caption
 */
app.post("/caption", async (req, res) => {
  try {
    const input = req.body as CaptionRequest;

    const caption = await generateCaption(input);

    res.json({
      status: "ok",
      caption,
    });
  } catch (error) {
    console.error("Caption generation failed:", error);

    res.status(500).json({
      status: "error",
      message: "Caption generation failed",
    });
  }
});

/*
 * Pilot bespoke-jewelry customer-service agent
 *
 * POST /customer-service/test
 * Body: { "message": "customer's message" }
 */
app.post("/customer-service/test", async (req, res) => {
  const input = (req.body ?? {}) as Partial<CustomerServiceRequest>;

  if (typeof input.message !== "string" || !input.message.trim()) {
    res.status(400).json({
      status: "error",
      message: "A non-empty string field named 'message' is required",
    });
    return;
  }

  if (input.history !== undefined &&
      (!Array.isArray(input.history) || input.history.length > 100 ||
       input.history.some((item) => !item ||
         (item.role !== "user" && item.role !== "assistant") ||
         typeof item.content !== "string" || !item.content.trim()))) {
    res.status(400).json({
      status: "error",
      message: "'history' must be an array of up to 100 user/assistant messages with non-empty string content",
    });
    return;
  }

  try {
    const messages = await generateCustomerServiceReply({
      message: input.message.trim(),
      history: input.history?.map(({ role, content }) => ({ role, content })),
    });

    res.json({
      status: "ok",
      messages,
    });
  } catch (error) {
    console.error("Customer-service reply generation failed:", error);

    res.status(500).json({
      status: "error",
      message: "Customer-service reply generation failed",
    });
  }
});

// Until a verified channel adapter exists, durable ingress is staff-authenticated.
// Customer supplied history, source, mode and confirmed flags are never accepted here.
app.post('/customer-service/messages', async (req, res) => {
 if (!req.headers.authorization || !authorized(req)) { res.status(401).json({status:'error',message:'Admin bearer authentication required for simulated ingress'}); return; }
 try { res.json(await receive(req.body.conversationId,req.body.message,req.body.externalId,'authenticated ingress (simulated)')); }
 catch(e) { res.status(400).json({status:'error',message:'Message could not be processed'}); }
});

async function start() {
 if (process.env.PGHOST || process.env.DATABASE_URL) await migrate();
 app.listen(port, () => {
  console.log(`Vivid Novel AI running on port ${port}`);
 });
}
start().catch(e=>{console.error('Startup/migration failed',e.message);process.exit(1);});

