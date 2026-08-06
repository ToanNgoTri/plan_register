/**
 * Admin script: đọc / sửa doc Firestore `config/app` — cấu hình bắt buộc cập
 * nhật mà ForceUpdateGate lắng nghe realtime.
 *
 * Rules chặn mọi client ghi vào `config/*` (firestore.rules), nên phải chạy
 * bằng quyền admin qua script này hoặc sửa tay trên Firebase Console.
 *
 * PREREQUISITES
 *   Admin credentials on this machine, either:
 *     gcloud auth application-default login
 *   or a service-account key file:
 *     export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
 *
 * RUN
 *   cd functions && npm install        # ensures firebase-admin is present
 *   node ../scripts/setAppConfig.js                       # chỉ xem config hiện tại
 *   node ../scripts/setAppConfig.js forceUpdate=false     # tắt bắt buộc cập nhật
 *   node ../scripts/setAppConfig.js forceUpdate=true minVersion=1.2
 *   node ../scripts/setAppConfig.js message="Hãy cập nhật" updateUrl=null
 *
 * FIELDS
 *   forceUpdate      boolean  công tắc tổng — chỉ `true` mới chặn app
 *   minVersion       string   thấp hơn mức này thì bị chặn (vd. "1.2")
 *   latestVersion    string   chỉ để hiển thị trong thông báo
 *   message          string   nội dung thông báo, ghi đè câu mặc định
 *   updateUrl        string   link tải chung (vd. APK nội bộ)
 *   updateUrlIos     string   link riêng iOS, ưu tiên hơn updateUrl
 *   updateUrlAndroid string   link riêng Android, ưu tiên hơn updateUrl
 */
const path = require('path');
// Reuse the firebase-admin installed for Cloud Functions.
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const PROJECT_ID = 'planregister-f3f94';

const BOOLEAN_FIELDS = ['forceUpdate'];
const STRING_FIELDS = [
  'minVersion',
  'latestVersion',
  'message',
  'updateUrl',
  'updateUrlIos',
  'updateUrlAndroid',
];

/** Parse `key=value` args into a Firestore patch, rejecting unknown fields. */
function parseArgs(argv) {
  const patch = {};
  for (const arg of argv) {
    const eq = arg.indexOf('=');
    if (eq < 0) {
      throw new Error(`Sai cú pháp: "${arg}" — cần dạng key=value.`);
    }
    const key = arg.slice(0, eq);
    const raw = arg.slice(eq + 1);
    if (BOOLEAN_FIELDS.includes(key)) {
      if (raw !== 'true' && raw !== 'false') {
        throw new Error(`"${key}" chỉ nhận true hoặc false, nhận được "${raw}".`);
      }
      patch[key] = raw === 'true';
    } else if (STRING_FIELDS.includes(key)) {
      patch[key] = raw === 'null' ? null : raw;
    } else {
      throw new Error(
        `Field không hợp lệ: "${key}". Chỉ nhận: ${[...BOOLEAN_FIELDS, ...STRING_FIELDS].join(', ')}.`,
      );
    }
  }
  return patch;
}

async function main() {
  const patch = parseArgs(process.argv.slice(2));

  admin.initializeApp({
    projectId: PROJECT_ID,
    credential: admin.credential.applicationDefault(),
  });
  const ref = admin.firestore().doc('config/app');

  const before = (await ref.get()).data() ?? {};
  console.log('config/app hiện tại:');
  console.log(JSON.stringify(before, null, 2));

  if (Object.keys(patch).length === 0) {
    console.log('\n(Không truyền field nào — chỉ đọc, không ghi gì.)');
    return;
  }

  // Merge để chỉ đụng vào field được truyền, các field khác giữ nguyên.
  await ref.set(
    { ...patch, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true },
  );

  const after = (await ref.get()).data();
  console.log('\nĐã cập nhật:', JSON.stringify(patch));
  console.log('config/app sau khi ghi:');
  console.log(JSON.stringify(after, null, 2));
  console.log(
    `\nforceUpdate = ${after.forceUpdate === true} → ${
      after.forceUpdate === true
        ? 'ĐANG BẮT BUỘC cập nhật (client dưới minVersion hoặc store có bản mới sẽ bị chặn).'
        : 'KHÔNG chặn ai cả.'
    }`,
  );
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('FAILED:', err.message ?? err);
    process.exit(1);
  });
