const crypto = require("crypto");

function isValidTelegramAuth(data, botToken) {
  if (!data || typeof data !== "object" || !data.hash) return false;
  const { hash, ...rest } = data;
  const checkString = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${rest[key]}`)
    .join("\n");

  const secret = crypto.createHash("sha256").update(botToken).digest();
  const computedHash = crypto
    .createHmac("sha256", secret)
    .update(checkString)
    .digest("hex");

  return computedHash === hash;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    res.status(500).json({ error: "Server not configured" });
    return;
  }

  const payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  if (!isValidTelegramAuth(payload, botToken)) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  // Минимальный набор безопасных данных
  const safeUser = {
    id: payload.id,
    first_name: payload.first_name || "",
    last_name: payload.last_name || "",
    username: payload.username || "",
    photo_url: payload.photo_url || "",
    auth_date: payload.auth_date
  };

  res.status(200).json({ ok: true, user: safeUser });
};
