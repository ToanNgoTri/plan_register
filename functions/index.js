/**
 * Cloud Functions for PlanRegister (server side; requires Firebase Blaze plan).
 *
 * The daily 08:00 reminder is handled entirely on-device (local notifee
 * schedule in the app), so it is NOT a Cloud Function. Cloud Messaging is only
 * used for the boss alert below, which must reach the boss even when the app is
 * closed.
 *
 *  1. onPlanRegistered  — when a staff member registers OR updates a plan, push
 *     FCM to all bosses. Works even when the boss app is closed. Uses
 *     onDocumentWritten (not onDocumentCreated) because a staff member has one
 *     entry doc per day (id = their uid); re-submitting the same day overwrites
 *     it as an UPDATE, which onDocumentCreated would miss.
 *  2. deleteUserAccount — callable (boss only): fully delete a user's Auth
 *     account + profile doc.
 *
 * Deploy:  cd functions && npm install && npm run deploy
 */
const {onDocumentWritten} = require("firebase-functions/v2/firestore");
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

// 1) Alert all bosses when a plan is registered OR updated.
exports.onPlanRegistered = onDocumentWritten(
    "history/{year}/months/{month}/days/{day}/entries/{uid}",
    async (event) => {
      const after = event.data && event.data.after;
      // No `after` → the entry was deleted; nothing to announce.
      if (!after || !after.exists) {
        return;
      }
      const entry = after.data();
      if (!entry) {
        return;
      }
      // Distinguish a brand-new registration from an edit of an existing one.
      const before = event.data.before;
      const isUpdate = before && before.exists;
      const verb = isUpdate ? "vừa cập nhật" : "vừa đăng ký";

      const bossSnap = await db
          .collection("users")
          .where("role", "==", "boss")
          .get();
      const tokens = bossSnap.docs
          .map((d) => d.data().fcmToken)
          .filter(Boolean);

      await sendToTokens(tokens, {
        title: `${entry.displayName} ${verb}`,
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
