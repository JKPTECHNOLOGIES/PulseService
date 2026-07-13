const webpush = require("web-push");
const prisma = require("../config/database");

// Configure VAPID from env. If keys aren't set, push is simply disabled (the
// public-key endpoint returns null and the frontend hides the feature).
const publicKey = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT || "mailto:admin@primecomfortac.com";

let enabled = false;
if (publicKey && privateKey) {
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    enabled = true;
  } catch (err) {
    console.error("[push] invalid VAPID config:", err.message);
  }
} else {
  console.log("[push] VAPID keys not set — web push disabled.");
}

const isEnabled = () => enabled;
const getPublicKey = () => (enabled ? publicKey : null);

/**
 * Sends a push notification to every subscription belonging to a user. Dead
 * subscriptions (410/404) are pruned automatically. Never throws — push is
 * best-effort and must not break the triggering request.
 */
async function sendToUser(userId, payload) {
  if (!enabled || !userId) return;
  try {
    const subs = await prisma.pushSubscription.findMany({ where: { userId } });
    const body = JSON.stringify(payload);
    await Promise.all(
      subs.map((sub) =>
        webpush
          .sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            body,
          )
          .catch(async (err) => {
            if (err.statusCode === 404 || err.statusCode === 410) {
              await prisma.pushSubscription
                .delete({ where: { id: sub.id } })
                .catch(() => undefined);
            }
          }),
      ),
    );
  } catch (err) {
    console.error("[push] sendToUser error:", err.message);
  }
}

module.exports = { isEnabled, getPublicKey, sendToUser };
