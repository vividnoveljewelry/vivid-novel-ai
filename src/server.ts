import express from "express";
import { Pool } from "pg";
import { createClient } from "redis";

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

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "vivid-novel-ai",
  });
});

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

app.listen(port, () => {
  console.log(`Vivid Novel AI running on port ${port}`);
});
