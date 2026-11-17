/**
 * Admin script (chạy MỘT LẦN): chuyển dữ liệu của bản cũ (chưa chia đơn vị) vào
 * một đơn vị — mặc định Phường Hàng Gòn, đơn vị duy nhất dùng app trước đây.
 *
 *  1. users chưa có unitId                → unitId = đơn vị, unit = tên đơn vị
 *  2. unit_chiefs/{đơn vị}                → Trưởng CA hiện có (nếu chưa có)
 *  3. history/…/entries/{uid}             → units/{đơn vị}/history/…/entries/{uid}
 *  4. duty_schedules, doc_numbers, doc_number_counters, doc_number_suffixes,
 *     doc_number_options                  → units/{đơn vị}/<cùng tên>
 *     (doc_number_locks là khoá tạm, bỏ qua)
 *  5. tệp lịch trực Storage duty/{force}/… → duty/{đơn vị}/{force}/… (giữ token
 *     tải về) và sửa storagePath/fileUrl trong duty_schedules mới
 *  6. tasks chưa có unitId                → unitId = đơn vị
 *
 * KHÔNG xoá dữ liệu cũ ở đường dẫn gốc (để làm bản lưu); rules mới không cho
 * app đọc/ghi các đường dẫn đó nữa. Chạy lại an toàn: chỉ ghi đè bằng đúng dữ
 * liệu cũ, và bỏ qua document đích đã tồn tại trừ khi --overwrite.
 *
 * Mặc định CHỈ XEM (dry-run). Thêm --apply để ghi thật.
 *
 * RUN
 *   node scripts/seedUnits.js --key=./serviceAccount.json            # trước!
 *   node scripts/migrateToUnits.js --key=./serviceAccount.json        # xem
 *   node scripts/migrateToUnits.js --key=./serviceAccount.json --apply
 *   … --unit=phuong-hang-gon   (đơn vị đích, mặc định Hàng Gòn)
 */
const { initAdmin, loadUnits, STORAGE_BUCKET } = require('./adminInit');

const FLAT_COLLECTIONS = [
  'duty_schedules',
  'doc_numbers',
  'doc_number_counters',
  'doc_number_suffixes',
  'doc_number_options',
];

async function main() {
  const { admin, opts, rest } = initAdmin(process.argv.slice(2));
  let unitId = 'phuong-hang-gon';
  let apply = false;
  let overwrite = false;
  for (const a of rest) {
    if (a === '--apply') {
      apply = true;
    } else if (a === '--overwrite') {
      overwrite = true;
    } else if (a.startsWith('--unit=')) {
      unitId = a.slice(7);
    } else {
      throw new Error(`Tham số không hợp lệ: "${a}"`);
    }
  }
  const unit = loadUnits().find(u => u.id === unitId);
  if (!unit) {
    throw new Error(`Không có đơn vị "${unitId}" trong src/config/units.js`);
  }
  const db = admin.firestore();
  if (!(await db.collection('units').doc(unitId).get()).exists) {
    throw new Error('Chưa có units/' + unitId + ' — chạy scripts/seedUnits.js trước.');
  }
  console.log(`Đơn vị đích: ${unit.name} (${unitId}) — ${apply ? 'GHI THẬT' : 'DRY-RUN'}\n`);

  const writer = db.bulkWriter();
  const write = (ref, data, merge = false) => {
    if (apply) {
      writer.set(ref, data, { merge });
    }
  };
  const unitRef = db.collection('units').doc(unitId);

  // 1. users
  const users = await db.collection('users').get();
  const noUnit = users.docs.filter(d => !d.data().unitId);
  noUnit.forEach(d => write(d.ref, { unitId, unit: unit.name }, true));
  console.log(`users: ${noUnit.length}/${users.size} hồ sơ được gán đơn vị.`);

  // 2. Trưởng CA
  const chiefRef = db.collection('unit_chiefs').doc(unitId);
  if (!(await chiefRef.get()).exists) {
    const chiefs = users.docs
      .filter(d => (d.data().unitId || unitId) === unitId)
      .filter(d => d.data().position === 'Trưởng CA')
      .sort((a, b) => (a.data().createdAt || 0) - (b.data().createdAt || 0));
    if (chiefs.length) {
      write(chiefRef, { uid: chiefs[0].id, at: Date.now() });
      console.log(`unit_chiefs/${unitId} → ${chiefs[0].data().fullName || chiefs[0].id}`);
      if (chiefs.length > 1) {
        console.log(`  (lưu ý: có ${chiefs.length} người mang chức vụ Trưởng CA)`);
      }
    } else {
      console.log('unit_chiefs: chưa có ai chức vụ Trưởng CA.');
    }
  }

  // 3. history entries (cha history/{y}/months/... thường là document "ma",
  // nên đi qua collectionGroup thay vì duyệt cây).
  const entries = await db.collectionGroup('entries').get();
  let nEntries = 0;
  for (const d of entries.docs) {
    if (!d.ref.path.startsWith('history/')) {
      continue;
    }
    const target = db.doc(`units/${unitId}/${d.ref.path}`);
    if (!overwrite && (await target.get()).exists) {
      continue;
    }
    write(target, { ...d.data(), unitId });
    nEntries += 1;
  }
  console.log(`history: ${nEntries} lượt đăng ký được chép.`);

  // 4 + 5. collection phẳng (+ tệp lịch trực)
  const bucket = opts.prod ? admin.storage().bucket(STORAGE_BUCKET) : null;
  for (const name of FLAT_COLLECTIONS) {
    const snap = await db.collection(name).get();
    let n = 0;
    for (const d of snap.docs) {
      const target = unitRef.collection(name).doc(d.id);
      if (!overwrite && (await target.get()).exists) {
        continue;
      }
      let data = d.data();
      if (name === 'duty_schedules' && data.storagePath && bucket) {
        data = await moveDutyFile(bucket, data, unitId, apply);
      }
      write(target, data);
      n += 1;
    }
    console.log(`${name}: ${n}/${snap.size} document được chép.`);
  }
  if (!bucket) {
    console.log('(emulator: bỏ qua bước chép tệp Storage)');
  }

  // 6. tasks
  const tasks = await db.collection('tasks').get();
  const tasksNoUnit = tasks.docs.filter(d => !d.data().unitId);
  tasksNoUnit.forEach(d => write(d.ref, { unitId }, true));
  console.log(`tasks: ${tasksNoUnit.length}/${tasks.size} nhiệm vụ được gán đơn vị.`);

  await writer.close();
  console.log(apply ? '\nXONG.' : '\nDRY-RUN — chưa ghi gì. Thêm --apply để ghi.');
}

/** duty/{force}/x → duty/{unitId}/{force}/x, giữ token tải về cũ. */
async function moveDutyFile(bucket, data, unitId, apply) {
  const oldPath = data.storagePath;
  if (oldPath.startsWith(`duty/${unitId}/`)) {
    return data;
  }
  const newPath = oldPath.replace(/^duty\//, `duty/${unitId}/`);
  const src = bucket.file(oldPath);
  const [exists] = await src.exists();
  if (!exists) {
    console.log(`  ! không thấy tệp ${oldPath}, giữ nguyên đường dẫn`);
    return data;
  }
  console.log(`  tệp ${oldPath} → ${newPath}`);
  if (!apply) {
    return { ...data, storagePath: newPath };
  }
  await src.copy(bucket.file(newPath));
  const [meta] = await bucket.file(newPath).getMetadata();
  const token = (meta.metadata?.firebaseStorageDownloadTokens || '').split(',')[0];
  const fileUrl = token
    ? `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(
        newPath,
      )}?alt=media&token=${token}`
    : data.fileUrl;
  return { ...data, storagePath: newPath, fileUrl };
}

main().then(
  () => process.exit(0),
  e => {
    console.error(e);
    process.exit(1);
  },
);
