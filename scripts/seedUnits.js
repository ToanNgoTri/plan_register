/**
 * Admin script: tạo/cập nhật database đơn vị `units/{id}` — 95 xã/phường của
 * Đồng Nai, lấy từ src/config/units.js.
 *
 * firestore.rules dùng collection này để chặn hồ sơ khai `unitId` không có
 * thật, nên PHẢI chạy trước khi phát hành bản app chọn đơn vị. Chạy lại bao
 * nhiêu lần cũng được (ghi đè tên, không đụng dữ liệu con của đơn vị).
 *
 * RUN
 *   cd functions && npm install            # firebase-admin
 *   node scripts/seedUnits.js              # emulator
 *   node scripts/seedUnits.js --key=./serviceAccount.json   # project thật
 */
const { initAdmin, loadUnits } = require('./adminInit');

async function main() {
  const { admin } = initAdmin(process.argv.slice(2));
  const db = admin.firestore();
  const units = loadUnits();
  const ids = new Set(units.map(u => u.id));
  if (ids.size !== units.length) {
    throw new Error('Danh mục có id trùng nhau.');
  }
  const batch = db.batch();
  units.forEach((u, i) => {
    batch.set(
      db.collection('units').doc(u.id),
      {
        name: u.name,
        type: u.name.startsWith('Phường') ? 'phuong' : 'xa',
        province: 'Đồng Nai',
        order: i,
        updatedAt: Date.now(),
      },
      { merge: true },
    );
  });
  await batch.commit();
  const phuong = units.filter(u => u.name.startsWith('Phường')).length;
  console.log(
    `Đã ghi ${units.length} đơn vị (${phuong} phường, ${units.length - phuong} xã) vào units/.`,
  );

  // Đơn vị có trên Firestore mà không còn trong danh mục: chỉ báo, không xoá
  // (có thể còn dữ liệu con).
  const snap = await db.collection('units').get();
  const extra = snap.docs.map(d => d.id).filter(id => !ids.has(id));
  if (extra.length) {
    console.log(`Lưu ý: có trên Firestore nhưng không còn trong danh mục: ${extra.join(', ')}`);
  }
}

main().then(
  () => process.exit(0),
  e => {
    console.error(e);
    process.exit(1);
  },
);
