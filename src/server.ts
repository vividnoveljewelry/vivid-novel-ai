import express from "express";
import { Pool } from "pg";
import { createClient } from "redis";
import { generateCaption, CaptionRequest } from "./caption";
import {
  CustomerServiceRequest,
  generateCustomerServiceReply,
} from "./customer-service/agent";

const app = express();

app.use(express.json());

const port = Number(process.env.PORT || 8080);

const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || "postgres",
});

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
  const input = req.body as Partial<CustomerServiceRequest>;

  if (typeof input.message !== "string" || !input.message.trim()) {
    res.status(400).json({
      status: "error",
      message: "A non-empty string field named 'message' is required",
    });
    return;
  }

  try {
    const reply = await generateCustomerServiceReply({
      message: input.message.trim(),
    });

    res.json({
      status: "ok",
      reply,
    });
  } catch (error) {
    console.error("Customer-service reply generation failed:", error);

    res.status(500).json({
      status: "error",
      message: "Customer-service reply generation failed",
    });
  }
});

app.listen(port, () => {
  console.log(`Vivid Novel AI running on port ${port}`);
});
