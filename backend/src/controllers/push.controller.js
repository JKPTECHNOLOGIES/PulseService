const prisma = require("../config/database");
const push = require("../services/push.service");

// Public VAPID key the browser needs to create a subscription.
const publicKey = (req, res) => {
  return res.json({ success: true, data: { key: push.getPublicKey() } });
};

// Store (or refresh) a browser push subscription for the current user.
const subscribe = async (req, res) => {
  try {
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid subscription" });
    }
    const sub = await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: {
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userId: req.user.id,
      },
      update: { p256dh: keys.p256dh, auth: keys.auth, userId: req.user.id },
    });
    return res.status(201).json({ success: true, data: { id: sub.id } });
  } catch (err) {
    console.error("push.subscribe error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const unsubscribe = async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (endpoint) {
      await prisma.pushSubscription
        .deleteMany({ where: { endpoint } })
        .catch(() => undefined);
    }
    return res.json({ success: true });
  } catch (err) {
    console.error("push.unsubscribe error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// Sends a test notification to the current user's devices (for verification).
const test = async (req, res) => {
  await push.sendToUser(req.user.id, {
    title: "PulseService",
    body: "Push notifications are working \uD83C\uDF89",
    url: "/dashboard",
  });
  return res.json({ success: true });
};

module.exports = { publicKey, subscribe, unsubscribe, test };
