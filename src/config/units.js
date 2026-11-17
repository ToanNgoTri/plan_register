/**
 * 95 đơn vị hành chính cấp xã của tỉnh Đồng Nai (33 phường + 62 xã).
 *
 * Mỗi tài khoản thuộc ĐÚNG MỘT đơn vị (`users/{uid}.unitId`), và mọi dữ liệu
 * nghiệp vụ (đăng ký công tác, lịch trực, sổ số văn bản) nằm dưới
 * `units/{unitId}/...` — người của đơn vị nào chỉ đọc/ghi được dữ liệu đơn vị
 * đó (firestore.rules). Nhiệm vụ chỉ giao được cho người cùng đơn vị.
 *
 * `id` là khoá VĨNH VIỄN (nằm trong đường dẫn dữ liệu và hồ sơ người dùng):
 * không bao giờ đổi id của một đơn vị đã dùng. Tên thì đổi thoải mái.
 * "Lộc Thành" và "Lộc Thạnh" bỏ dấu ra trùng nhau nên Lộc Thạnh mang hậu tố
 * `-nang` (dấu nặng).
 *
 * Bản sao trên Firestore (`units/{id}`) do scripts/seedUnits.js ghi; rules
 * dùng nó để chặn `unitId` không có thật. Sửa danh sách này thì chạy lại
 * script đó.
 */
export const UNITS = [
  { id: 'phuong-an-loc', name: 'Phường An Lộc' },
  { id: 'phuong-bao-vinh', name: 'Phường Bảo Vinh' },
  { id: 'phuong-bien-hoa', name: 'Phường Biên Hòa' },
  { id: 'phuong-binh-long', name: 'Phường Bình Long' },
  { id: 'phuong-binh-loc', name: 'Phường Bình Lộc' },
  { id: 'phuong-binh-phuoc', name: 'Phường Bình Phước' },
  { id: 'phuong-chon-thanh', name: 'Phường Chơn Thành' },
  { id: 'phuong-dau-giay', name: 'Phường Dầu Giây' },
  { id: 'phuong-dong-phu', name: 'Phường Đồng Phú' },
  { id: 'phuong-dong-xoai', name: 'Phường Đồng Xoài' },
  { id: 'phuong-hang-gon', name: 'Phường Hàng Gòn' },
  { id: 'phuong-ho-nai', name: 'Phường Hố Nai' },
  { id: 'phuong-long-binh', name: 'Phường Long Bình' },
  { id: 'phuong-long-hung', name: 'Phường Long Hưng' },
  { id: 'phuong-long-khanh', name: 'Phường Long Khánh' },
  { id: 'phuong-long-thanh', name: 'Phường Long Thành' },
  { id: 'phuong-loc-ninh', name: 'Phường Lộc Ninh' },
  { id: 'phuong-minh-hung', name: 'Phường Minh Hưng' },
  { id: 'phuong-nhon-trach', name: 'Phường Nhơn Trạch' },
  { id: 'phuong-phuoc-binh', name: 'Phường Phước Bình' },
  { id: 'phuong-phuoc-long', name: 'Phường Phước Long' },
  { id: 'phuong-phuoc-tan', name: 'Phường Phước Tân' },
  { id: 'phuong-tam-hiep', name: 'Phường Tam Hiệp' },
  { id: 'phuong-tam-phuoc', name: 'Phường Tam Phước' },
  { id: 'phuong-tan-khai', name: 'Phường Tân Khai' },
  { id: 'phuong-tan-phu', name: 'Phường Tân Phú' },
  { id: 'phuong-tan-trieu', name: 'Phường Tân Triều' },
  { id: 'phuong-trang-bom', name: 'Phường Trảng Bom' },
  { id: 'phuong-trang-dai', name: 'Phường Trảng Dài' },
  { id: 'phuong-tran-bien', name: 'Phường Trấn Biên' },
  { id: 'phuong-tri-an', name: 'Phường Trị An' },
  { id: 'phuong-xuan-lap', name: 'Phường Xuân Lập' },
  { id: 'phuong-xuan-loc', name: 'Phường Xuân Lộc' },
  { id: 'xa-an-phuoc', name: 'Xã An Phước' },
  { id: 'xa-an-vien', name: 'Xã An Viễn' },
  { id: 'xa-bau-ham', name: 'Xã Bàu Hàm' },
  { id: 'xa-binh-an', name: 'Xã Bình An' },
  { id: 'xa-binh-minh', name: 'Xã Bình Minh' },
  { id: 'xa-binh-tan', name: 'Xã Bình Tân' },
  { id: 'xa-bom-bo', name: 'Xã Bom Bo' },
  { id: 'xa-bu-dang', name: 'Xã Bù Đăng' },
  { id: 'xa-bu-gia-map', name: 'Xã Bù Gia Mập' },
  { id: 'xa-cam-my', name: 'Xã Cẩm Mỹ' },
  { id: 'xa-da-kia', name: 'Xã Đa Kia' },
  { id: 'xa-dai-phuoc', name: 'Xã Đại Phước' },
  { id: 'xa-dak-lua', name: 'Xã Đak Lua' },
  { id: 'xa-dak-nhau', name: 'Xã Đak Nhau' },
  { id: 'xa-dak-o', name: 'Xã Đăk Ơ' },
  { id: 'xa-dinh-quan', name: 'Xã Định Quán' },
  { id: 'xa-dong-tam', name: 'Xã Đồng Tâm' },
  { id: 'xa-gia-kiem', name: 'Xã Gia Kiệm' },
  { id: 'xa-hung-phuoc', name: 'Xã Hưng Phước' },
  { id: 'xa-hung-thinh', name: 'Xã Hưng Thịnh' },
  { id: 'xa-la-nga', name: 'Xã La Ngà' },
  { id: 'xa-long-ha', name: 'Xã Long Hà' },
  { id: 'xa-long-phuoc', name: 'Xã Long Phước' },
  { id: 'xa-loc-hung', name: 'Xã Lộc Hưng' },
  { id: 'xa-loc-quang', name: 'Xã Lộc Quang' },
  { id: 'xa-loc-tan', name: 'Xã Lộc Tấn' },
  { id: 'xa-loc-thanh', name: 'Xã Lộc Thành' },
  { id: 'xa-loc-thanh-nang', name: 'Xã Lộc Thạnh' },
  { id: 'xa-minh-duc', name: 'Xã Minh Đức' },
  { id: 'xa-nam-cat-tien', name: 'Xã Nam Cát Tiên' },
  { id: 'xa-nghia-trung', name: 'Xã Nghĩa Trung' },
  { id: 'xa-nha-bich', name: 'Xã Nha Bích' },
  { id: 'xa-phu-hoa', name: 'Xã Phú Hòa' },
  { id: 'xa-phu-lam', name: 'Xã Phú Lâm' },
  { id: 'xa-phu-ly', name: 'Xã Phú Lý' },
  { id: 'xa-phu-nghia', name: 'Xã Phú Nghĩa' },
  { id: 'xa-phu-rieng', name: 'Xã Phú Riềng' },
  { id: 'xa-phu-trung', name: 'Xã Phú Trung' },
  { id: 'xa-phu-vinh', name: 'Xã Phú Vinh' },
  { id: 'xa-phuoc-an', name: 'Xã Phước An' },
  { id: 'xa-phuoc-son', name: 'Xã Phước Sơn' },
  { id: 'xa-phuoc-thai', name: 'Xã Phước Thái' },
  { id: 'xa-song-ray', name: 'Xã Sông Ray' },
  { id: 'xa-ta-lai', name: 'Xã Tà Lài' },
  { id: 'xa-tan-an', name: 'Xã Tân An' },
  { id: 'xa-tan-hung', name: 'Xã Tân Hưng' },
  { id: 'xa-tan-loi', name: 'Xã Tân Lợi' },
  { id: 'xa-tan-quan', name: 'Xã Tân Quan' },
  { id: 'xa-tan-tien', name: 'Xã Tân Tiến' },
  { id: 'xa-thanh-son', name: 'Xã Thanh Sơn' },
  { id: 'xa-thien-hung', name: 'Xã Thiện Hưng' },
  { id: 'xa-tho-son', name: 'Xã Thọ Sơn' },
  { id: 'xa-thong-nhat', name: 'Xã Thống Nhất' },
  { id: 'xa-thuan-loi', name: 'Xã Thuận Lợi' },
  { id: 'xa-xuan-bac', name: 'Xã Xuân Bắc' },
  { id: 'xa-xuan-dinh', name: 'Xã Xuân Định' },
  { id: 'xa-xuan-dong', name: 'Xã Xuân Đông' },
  { id: 'xa-xuan-duong', name: 'Xã Xuân Đường' },
  { id: 'xa-xuan-hoa', name: 'Xã Xuân Hòa' },
  { id: 'xa-xuan-phu', name: 'Xã Xuân Phú' },
  { id: 'xa-xuan-que', name: 'Xã Xuân Quế' },
  { id: 'xa-xuan-thanh', name: 'Xã Xuân Thành' },
];

/** Đơn vị theo id, hoặc null nếu id lạ / rỗng. */
export function unitById(id) {
  return UNITS.find(u => u.id === id) ?? null;
}

/** Tên hiển thị của đơn vị; id lạ thì trả lại chính id cho khỏi mất dấu vết. */
export function unitName(id) {
  return unitById(id)?.name ?? id ?? '';
}

/** Đơn vị của dữ liệu cũ (trước khi tách đơn vị) — xem scripts/migrateToUnits.js. */
export const LEGACY_UNIT_ID = 'phuong-hang-gon';
