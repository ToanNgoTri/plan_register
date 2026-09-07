/**
 * Admin script: xem / tạo field `types` (danh mục loại văn bản) trong
 * `doc_number_options/lists`.
 *
 * VÌ SAO CẦN SCRIPT NÀY
 *   Danh mục loại văn bản nằm trong dữ liệu để thêm/bớt loại không phải ra bản
 *   cập nhật app. Nhưng field `types` chỉ SINH RA khi có người bấm "Lưu danh
 *   mục" trong app (bản 1.4 trở lên) — trước đó document chỉ có `signers` và
 *   `units`, và app tự lùi về danh mục mặc định trong mã nguồn. Script này ghi
 *   sẵn danh mục mặc định vào dữ liệu để sửa được ngay trên Firebase Console,
 *   không phải đợi phát hành app.
 *
 *   Ghi bằng merge và CHỈ đụng field `types` — `signers`, `units` giữ nguyên.
 *
 * AN TOÀN
 *   Mặc định làm việc với EMULATOR (localhost:8080). Muốn đụng vào project thật
 *   phải truyền --prod một cách có chủ đích.
 *
 * PREREQUISITES
 *   cd functions && npm install        # ensures firebase-admin is present
 *   Với --prod: gcloud auth application-default login
 *               (hoặc --key=./serviceAccount.json)
 *
 * RUN
 *   node scripts/setDocTypes.js --list                    # xem đang có gì (emulator)
 *   node scripts/setDocTypes.js --list --key=./serviceAccount.json   # xem trên project thật
 *   node scripts/setDocTypes.js --write                   # ghi danh mục mặc định (emulator)
 *   node scripts/setDocTypes.js --write --key=./serviceAccount.json  # GHI VÀO PROJECT THẬT
 *   node scripts/setDocTypes.js --write --from=./types.json          # ghi danh mục tự soạn
 */
const fs = require('fs');
const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const PROJECT_ID = 'planregister-f3f94';
const EMULATOR_PROJECT_ID = 'demo-planregister';
const DEFAULT_EMULATOR_HOST = 'localhost:8080';

/**
 * Đọc DEFAULT_DOC_TYPES thẳng từ src/config/constants.js — cùng cách
 * seedDocNumbers.js làm. Chép tay danh mục sang đây thì lệch ngay lần đầu ai đó
 * thêm một loại văn bản mới.
 */
function loadDefaultDocTypes() {
  const file = path.join(__dirname, '..', 'src', 'config', 'constants.js');
  const src = fs.readFileSync(file, 'utf8');
  const m = src.match(
    new RegExp(String.raw`export const DEFAULT_DOC_TYPES = (\[[\s\S]*?\n\]);`),
  );
  if (!m) {
    throw new Error(`Không tìm thấy DEFAULT_DOC_TYPES trong ${file}`);
  }
  // eslint-disable-next-line no-new-func
  const value = new Function(`return ${m[1]};`)();
  if (!Array.isArray(value) || !value.length) {
    throw new Error('DEFAULT_DOC_TYPES đọc được nhưng rỗng.');
  }
  return value;
}

/**
 * Cùng luật với cleanDocTypes trong docNumberService: id chỉ gồm chữ và số,
 * không trùng, tên không rỗng. Kiểm ở đây để không ghi vào dữ liệu một danh mục
 * mà app sẽ im lặng bỏ qua.
 */
function validate(types) {
  const seen = new Set();
  types.forEach((t, i) => {
    if (!t || typeof t !== 'object') {
      throw new Error(`Phần tử ${i} không phải object`);
    }
    if (!String(t.label ?? '').trim()) {
      throw new Error(`Phần tử ${i} thiếu "label"`);
    }
    if (!/^[A-Za-z0-9]{1,16}$/.test(String(t.id ?? ''))) {
      throw new Error(
        `Phần tử ${i} ("${t.label}") có id không hợp lệ: "${t.id}". ` +
          'Id chỉ được gồm chữ và số (không dấu, không khoảng trắng).',
      );
    }
    if (seen.has(t.id)) {
      throw new Error(`Id "${t.id}" bị trùng — mỗi loại là một dãy số riêng.`);
    }
    seen.add(t.id);
  });
  return types.map(t => ({
    id: String(t.id),
    label: String(t.label).trim(),
    abbr: String(t.abbr ?? '').trim(),
  }));
}

function parseArgs(argv) {
  const opts = { prod: false, list: false, write: false, key: null, from: null };
  for (const arg of argv) {
    if (arg === '--prod') {
      opts.prod = true;
    } else if (arg === '--list') {
      opts.list = true;
    } else if (arg === '--write') {
      opts.write = true;
    } else if (arg.startsWith('--key=')) {
      opts.key = arg.slice(6).replace(/^"|"$/g, '');
      opts.prod = true;
    } else if (arg.startsWith('--from=')) {
      opts.from = arg.slice(7).replace(/^"|"$/g, '');
    } else {
      throw new Error(`Tham số không hợp lệ: "${arg}"`);
    }
  }
  if (!opts.list && !opts.write) {
    throw new Error('Cần --list (chỉ xem) hoặc --write (ghi).');
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

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
    });
    console.log(`⚠  PROJECT THẬT: ${PROJECT_ID}\n`);
  } else {
    process.env.FIRESTORE_EMULATOR_HOST =
      process.env.FIRESTORE_EMULATOR_HOST || DEFAULT_EMULATOR_HOST;
    admin.initializeApp({ projectId: EMULATOR_PROJECT_ID });
    console.log(
      `EMULATOR ${process.env.FIRESTORE_EMULATOR_HOST} ` +
        `(project ${EMULATOR_PROJECT_ID}). Dùng --prod để đụng project thật.\n`,
    );
  }

  const ref = admin.firestore().collection('doc_number_options').doc('lists');
  const snap = await ref.get();
  const data = snap.exists ? snap.data() : null;

  console.log(`doc_number_options/lists: ${snap.exists ? 'CÓ' : 'CHƯA CÓ'}`);
  if (data) {
    console.log(`  signers: ${data.signers ? `${data.signers.length} tên` : '(không có)'}`);
    console.log(`  units:   ${data.units ? `${data.units.length} đơn vị` : '(không có)'}`);
    console.log(
      `  types:   ${
        data.types
          ? `${data.types.length} loại`
          : '(KHÔNG CÓ → app đang dùng danh mục mặc định trong mã nguồn)'
      }`,
    );
    (data.types ?? []).forEach(t =>
      console.log(`      ${String(t.id).padEnd(6)} ${t.abbr ? `/${t.abbr}`.padEnd(6) : '(số trần)'.padEnd(6)} ${t.label}`),
    );
  }

  if (!opts.write) {
    return;
  }

  const source = opts.from
    ? JSON.parse(fs.readFileSync(opts.from, 'utf8'))
    : loadDefaultDocTypes();
  const types = validate(Array.isArray(source) ? source : source.types);

  // Chỉ đụng field `types`. Dùng merge để không xoá signers/units đang có.
  await ref.set({ types, updatedAt: Date.now() }, { merge: true });
  console.log(`\nĐã ghi ${types.length} loại vào field \`types\`.`);
  console.log('Từ giờ sửa danh mục ngay trong app (⚙️ danh mục) hoặc trên Console.');
}

main().catch(e => {
  console.error(`\nLỖI: ${e.message}`);
  process.exit(1);
});
