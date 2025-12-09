require("dotenv").config();
const path = require("path");
const express = require("express");

const telegramAuthHandler = require("./api/telegram-auth");

const app = express();
const PORT = process.env.PORT || 3000;
const staticDir = __dirname;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Telegram auth endpoint
app.post("/api/telegram-auth", telegramAuthHandler);
app.all("/api/telegram-auth", (_req, res) =>
  res.status(405).json({ error: "Method not allowed" })
);

// Static assets for the SPA
app.use(express.static(staticDir));

// SPA fallback for any non-API route
app.use((_req, res) => {
  res.sendFile(path.join(staticDir, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Web app running at http://localhost:${PORT}`);
});
