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
 *  3. onTaskWritten — nhiệm vụ: báo cho BÊN CÒN LẠI mỗi khi có sự kiện (giao
 *     mới, sửa, báo hoàn thành, hoãn, duyệt, từ chối, huỷ). Chuông "đến hạn"
 *     thì hẹn cục bộ trên máy (notifee), không phải ở đây.
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

// 3) Nhiệm vụ: đẩy thông báo sự kiện cho bên còn lại.
const TASK_CHANNEL_ID = "task-alerts";

/**
 * "16/07/2026 14:30" theo giờ Việt Nam.
 * @param {number} ms Thời điểm (ms).
 * @return {string} Chuỗi ngày giờ.
 */
function fmtVN(ms) {
  const d = new Date(ms + 7 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/` +
    `${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/**
 * Gửi thông báo nhiệm vụ tới một người (theo fcmToken trên hồ sơ).
 *
 * Nhiều tài khoản từng đăng nhập trên CÙNG một máy sẽ cùng giữ một token, nên
 * gửi theo token của người nhận có thể đổ chuông ở máy đang do người khác
 * (thường chính là người vừa thao tác) sử dụng. Vì vậy bỏ qua khi:
 *  - token đó cũng là token của người vừa thao tác (`actorUid`), hoặc
 *  - có tài khoản khác giữ cùng token với `fcmTokenAt` mới hơn
 *    (người đăng nhập gần nhất mới là người đang dùng máy).
 * @param {string} uid Người nhận thông báo.
 * @param {string} actorUid Người vừa thao tác (không bao giờ tự báo mình).
 * @param {string} taskId Id nhiệm vụ (để app mở đúng nhiệm vụ).
 * @param {{title: string, body: string}} notification Nội dung.
 * @return {Promise<void>}
 */
async function notifyTaskUser(uid, actorUid, taskId, notification) {
  if (!uid || uid === actorUid) {
    return;
  }
  const users = db.collection("users");
  const snap = await users.doc(uid).get();
  const me = snap.exists ? snap.data() : null;
  const token = me ? me.fcmToken : null;
  if (!token) {
    return;
  }
  const holders = await users.where("fcmToken", "==", token).get();
  const myAt = me.fcmTokenAt || 0;
  const stale = holders.docs.some((d) => d.id !== uid &&
    (d.id === actorUid || (d.data().fcmTokenAt || 0) > myAt));
  if (stale) {
    logger.info(`Task FCM to ${uid} skipped: token now used by another user`);
    return;
  }
  try {
    await admin.messaging().send({
      token,
      notification,
      data: {kind: "task", taskId, toUid: uid},
      android: {
        priority: "high",
        notification: {channelId: TASK_CHANNEL_ID, sound: "default"},
      },
      apns: {payload: {aps: {"sound": "default", "content-available": 1}}},
    });
  } catch (e) {
    logger.warn(`Task FCM to ${uid} failed: ${e.message}`);
  }
}

exports.onTaskWritten = onDocumentWritten("tasks/{taskId}", async (event) => {
  const taskId = event.params.taskId;
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;

  if (!after) {
    if (before && before.status !== "approved") {
      await notifyTaskUser(before.assigneeUid, before.assignerUid, taskId, {
        title: "Nhiệm vụ đã bị huỷ",
        body: `${before.assignerName} đã huỷ: ${before.title}`,
      });
    }
    return;
  }
  const due = `Hạn ${fmtVN(after.dueAt)}`;
  if (!before) {
    await notifyTaskUser(after.assigneeUid, after.assignerUid, taskId, {
      title: `📋 Nhiệm vụ mới từ ${after.assignerName}`,
      body: `${after.title}
${due}`,
    });
    return;
  }

  const beforeLog = Array.isArray(before.log) ? before.log.length : 0;
  const log = Array.isArray(after.log) ? after.log : [];
  if (log.length <= beforeLog) {
    return; // không có sự kiện mới
  }
  const last = log[log.length - 1];
  // Người nhận thao tác → báo người giao; người giao thao tác → báo người nhận.
  const actor = last.byUid;
  const note = last.note ? `
“${last.note}”` : "";
  switch (last.type) {
    case "submitted":
      await notifyTaskUser(after.assignerUid, actor, taskId, {
        title: `✅ ${after.assigneeName} báo hoàn thành`,
        body: `${after.title}
Vào app để duyệt hoặc từ chối.`,
      });
      break;
    case "postponed":
      await notifyTaskUser(after.assignerUid, actor, taskId, {
        title: `⏸ ${after.assigneeName} xin hoãn`,
        body: `${after.title}
${due}${note}`,
      });
      break;
    case "approved":
      await notifyTaskUser(after.assigneeUid, actor, taskId, {
        title: "🎉 Nhiệm vụ đã được duyệt",
        body: after.title,
      });
      break;
    case "rejected":
      await notifyTaskUser(after.assigneeUid, actor, taskId, {
        title: `✖ Bị từ chối: ${after.title}`,
        body: `${after.rejectReason || ""}
${due}`,
      });
      break;
    case "edited":
      await notifyTaskUser(after.assigneeUid, actor, taskId, {
        title: "📝 Nhiệm vụ được cập nhật",
        body: `${after.title}
${due}`,
      });
      break;
    default:
      break;
  }
});
