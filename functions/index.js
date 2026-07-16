/**
 * Cloud Functions for PlanRegister (server side; requires Firebase Blaze plan).
 *
 * The daily 08:00 reminder is handled entirely on-device (local notifee
 * schedule in the app), so it is NOT a Cloud Function. Cloud Messaging is only
 * used for the boss alert below, which must reach the boss even when the app is
 * closed.
 *
 *  1. onPlanRegistered  — when a staff member registers a plan, push FCM to
 *     all bosses. Works even when the boss app is closed.
 *  2. deleteUserAccount — callable (boss only): fully delete a user's Auth
 *     account + profile doc.
 *
 * Deploy:  cd functions && npm install && npm run deploy
 */
const {onDocumentCreated} = require("firebase-functions/v2/firestore");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {logger} = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

/**
 * Send a notification to a list of FCM tokens (deduped, empties dropped).
 * @param {string[]} tokens Device FCM tokens.
 * @param {{title: string, body: string}} notification Notification payload.
 * @return {Promise<object>} Multicast send result (successCount/failureCount).
 */
async function sendToTokens(tokens, notification) {
  const unique = [...new Set(tokens.filter(Boolean))];
  if (unique.length === 0) {
    return {successCount: 0, failureCount: 0};
  }
  const res = await admin.messaging().sendEachForMulticast({
    tokens: unique,
    notification,
    android: {priority: "high"},
    apns: {payload: {aps: {sound: "default"}}},
  });
  logger.info(
      `FCM sent: ok=${res.successCount} fail=${res.failureCount}` +
      ` of ${unique.length}`,
  );
  return res;
}

// 1) Alert all bosses when a plan is registered.
exports.onPlanRegistered = onDocumentCreated(
    "history/{year}/months/{month}/days/{day}/entries/{uid}",
    async (event) => {
      const entry = event.data && event.data.data();
      if (!entry) {
        return;
      }
      const bossSnap = await db
          .collection("users")
          .where("role", "==", "boss")
          .get();
      const tokens = bossSnap.docs
          .map((d) => d.data().fcmToken)
          .filter(Boolean);

      await sendToTokens(tokens, {
        title: `${entry.displayName}${
        entry.unit ? ` (${entry.unit})` : ""
        } vừa đăng ký`,
        body: entry.content || "Đã đăng ký kế hoạch công tác.",
      });
    },
);

// 2) Boss-only: fully delete a user (Auth account + profile document).
exports.deleteUserAccount = onCall(async (request) => {
  const callerUid = request.auth && request.auth.uid;
  if (!callerUid) {
    throw new HttpsError("unauthenticated", "Phải đăng nhập.");
  }
  const callerSnap = await db.collection("users").doc(callerUid).get();
  if (!callerSnap.exists || callerSnap.data().role !== "boss") {
    throw new HttpsError("permission-denied", "Chỉ quản lý mới được xóa.");
  }
  const targetUid = request.data && request.data.uid;
  if (!targetUid) {
    throw new HttpsError("invalid-argument", "Thiếu uid.");
  }

  await db.collection("users").doc(targetUid).delete();
  try {
    await admin.auth().deleteUser(targetUid);
  } catch (e) {
    logger.warn(`Auth user ${targetUid} not deleted: ${e.message}`);
  }
  return {ok: true};
});
