/**
 * Khởi tạo firebase-admin dùng chung cho các script admin.
 *
 *   (mặc định)      → EMULATOR localhost:8080, project demo-planregister
 *   --prod          → project thật, Application Default Credentials
 *   --key=./sa.json → project thật, chỉ thẳng file service-account (ngụ ý --prod)
 *
 * Trả về { admin, opts, rest } với `rest` là các tham số còn lại cho script tự xử.
 */
const fs = require('fs');
const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const PROJECT_ID = 'planregister-f3f94';
const EMULATOR_PROJECT_ID = 'demo-planregister';
const STORAGE_BUCKET = 'planregister-f3f94.firebasestorage.app';

function initAdmin(argv) {
  const opts = { prod: false, key: null };
  const rest = [];
  for (const arg of argv) {
    if (arg === '--prod') {
      opts.prod = true;
    } else if (arg.startsWith('--key=')) {
      opts.key = arg.slice(6).replace(/^"|"$/g, '');
      opts.prod = true;
    } else {
      rest.push(arg);
    }
  }
  if (opts.prod) {
    if (opts.key) {
      if (!fs.existsSync(opts.key)) {
        throw new Error(`Không thấy file khoá service-account: ${opts.key}`);
      }
      process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(opts.key);
    }
    admin.initializeApp({
      projectId: PROJECT_ID,
      credential: admin.credential.applicationDefault(),
      storageBucket: STORAGE_BUCKET,
    });
    console.log(`⚠  PROJECT THẬT: ${PROJECT_ID}\n`);
  } else {
    process.env.FIRESTORE_EMULATOR_HOST =
      process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
    admin.initializeApp({ projectId: EMULATOR_PROJECT_ID });
    console.log(
      `EMULATOR ${process.env.FIRESTORE_EMULATOR_HOST} (project ${EMULATOR_PROJECT_ID}). ` +
        'Dùng --prod hoặc --key=... cho project thật.\n',
    );
  }
  return { admin, opts, rest };
}

/**
 * Đọc danh mục UNITS thẳng từ src/config/units.js (file ESM của app) thay vì
 * chép lại — chép tay sẽ lệch ngay lần đầu ai đó sửa danh mục.
 */
function loadUnits() {
  const file = path.join(__dirname, '..', 'src', 'config', 'units.js');
  const src = fs.readFileSync(file, 'utf8');
  const m = src.match(/export const UNITS = (\[[\s\S]*?\n\]);/);
  if (!m) {
    throw new Error(`Không tìm thấy UNITS trong ${file}`);
  }
  // eslint-disable-next-line no-new-func
  return Function(`"use strict"; return (${m[1]});`)();
}

module.exports = { initAdmin, loadUnits, STORAGE_BUCKET };
