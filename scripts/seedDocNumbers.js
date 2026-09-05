/**
 * Admin script: tạo dữ liệu mẫu cho sổ số văn bản (màn hình "Số VB").
 *
 * Sinh ~22 văn bản đã lấy số cho MỖI loại trong DOC_TYPES (21 loại → ~460 văn
 * bản), rồi đặt lại bộ đếm `doc_number_counters/{năm}-{loại}` để số tiếp theo
 * lấy trong app nối đúng vào dãy đã sinh.
 *
 * Rules cấm client ghi đè / xoá văn bản đã cấp số, nên phải chạy bằng quyền
 * admin qua script này.
 *
 * AN TOÀN
 *   Mặc định ghi vào EMULATOR (localhost:8080). Muốn ghi vào project thật phải
 *   truyền --prod một cách có chủ đích. Mọi document do script tạo đều mang
 *   cờ `seeded: true` nên --clear dọn lại được sạch, không đụng số thật.
 *
 * PREREQUISITES
 *   cd functions && npm install        # ensures firebase-admin is present
 *   Với --prod: gcloud auth application-default login
 *               (hoặc GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json)
 *
 * RUN
 *   # Emulator (khuyên dùng để thử nghiệm):
 *   npx firebase emulators:start --only firestore --project demo-planregister
 *   node scripts/seedDocNumbers.js
 *
 *   node scripts/seedDocNumbers.js --per=22 --year=2026
 *   node scripts/seedDocNumbers.js --clear          # xoá dữ liệu mẫu
 *   node scripts/seedDocNumbers.js --prod           # GHI VÀO PROJECT THẬT
 *   node scripts/seedDocNumbers.js --key=./sa.json  # id., chỉ thẳng file service-account
 *   node scripts/seedDocNumbers.js --key=./sa.json --clear
 */
const fs = require('fs');
const path = require('path');
// Reuse the firebase-admin installed for Cloud Functions.
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const PROJECT_ID = 'planregister-f3f94';
const EMULATOR_PROJECT_ID = 'demo-planregister';
const DEFAULT_EMULATOR_HOST = 'localhost:8080';
const BATCH_LIMIT = 500;

// ---------------------------------------------------------------------------
// Danh mục loại văn bản
// ---------------------------------------------------------------------------

/**
 * Đọc DOC_TYPES thẳng từ src/config/constants.js thay vì chép lại vào đây.
 *
 * Không require() được vì constants.js là ESM và import 'react-native', nên
 * script cắt lấy đúng mảng literal rồi eval. Chép tay danh mục sang script sẽ
 * lệch với app ngay lần đầu ai đó thêm một loại văn bản mới.
 */
function loadArrayConst(name) {
  const file = path.join(__dirname, '..', 'src', 'config', 'constants.js');
  const src = fs.readFileSync(file, 'utf8');
  // String.raw để dấu gạch chéo của biểu thức chính quy khỏi phải nhân đôi.
  const re = new RegExp(String.raw`export const ${name} = (\[[\s\S]*?\n\]);`);
  const m = src.match(re);
  if (!m) {
    throw new Error(`Không tìm thấy ${name} trong ${file}`);
  }
  // eslint-disable-next-line no-new-func
  const value = new Function(`return ${m[1]};`)();
  if (!Array.isArray(value) || !value.length) {
    throw new Error(`${name} đọc được nhưng rỗng.`);
  }
  return value;
}
const loadDocTypes = () => loadArrayConst('DOC_TYPES');


/** Giống formatDocNumber trong docNumberService: Công văn không có viết tắt. */
function formatDocNumber(seq, abbr, suffix = '') {
  const num = `${seq}${suffix || ''}`;
  return abbr ? `${num}/${abbr}` : num;
}

// ---------------------------------------------------------------------------
// Kho nội dung để sinh trích yếu
// ---------------------------------------------------------------------------

/**
 * Người ký và đơn vị ban hành: đọc thẳng từ DEFAULT_SIGNERS /
 * DEFAULT_ISSUING_UNITS trong constants.js, cùng nguồn với dropdown trong app.
 * Chép lại vào đây thì dữ liệu mẫu sẽ đầy những cái tên không có trong dropdown
 * và người dùng tưởng danh mục bị thiếu.
 */
const SIGNERS = loadArrayConst('DEFAULT_SIGNERS');
const UNITS = loadArrayConst('DEFAULT_ISSUING_UNITS');

/** Bao nhiêu số trong mỗi loại được thêm một văn bản phụ (12A). */
const SUFFIXED_PER_TYPE = 2;

const PEOPLE = [
  'đồng chí Nguyễn Văn An',
  'đồng chí Trần Thị Bình',
  'đồng chí Lê Hoàng Cường',
  'đồng chí Phạm Minh Dũng',
  'đồng chí Vũ Thị Hạnh',
  'đồng chí Đặng Quốc Khánh',
  'đồng chí Bùi Thanh Lâm',
  'đồng chí Hoàng Văn Nam',
];

/**
 * Mốc thời gian gắn vào trích yếu, tra theo THÁNG lấy số (0 = tháng 1).
 *
 * Phải suy ra từ ngày lấy số chứ không xoay vòng tuỳ ý: một kế hoạch "quý I"
 * mà số lại được cấp vào tháng 8 thì nhìn là biết dữ liệu bịa.
 */
const PERIOD_BY_MONTH = [
  'dịp Tết Nguyên đán {year}',
  'tháng 02/{year}',
  'quý I/{year}',
  'dịp lễ 30/4 và 01/5/{year}',
  'tháng 5/{year}',
  '6 tháng đầu năm {year}',
  'tháng 7/{year}',
  'dịp Quốc khánh 02/9/{year}',
  'quý III/{year}',
  'tháng 10/{year}',
  'tháng 11/{year}',
  'năm {year}',
];

/**
 * Mỗi loại văn bản: cách mở đầu trích yếu + kho chủ đề riêng.
 *
 * `periodic: true`  → `prefix` + chủ đề + mốc thời gian (kế hoạch, báo cáo...).
 * `periodic: false` → `template` ghép chủ đề với MỘT CON NGƯỜI cụ thể (giấy
 *                     mời, giấy giới thiệu, nghỉ phép...). Gắn mốc thời gian
 *                     vào những loại này sẽ đọc rất ngô nghê.
 */
const CONTENT = {
  NQ: {
    prefix: 'Về việc',
    periodic: true,
    topics: [
      'lãnh đạo công tác bảo đảm an ninh trật tự trên địa bàn',
      'kiện toàn tổ chức bộ máy các đội công tác',
      'triển khai đợt cao điểm tấn công trấn áp tội phạm',
      'nâng cao chất lượng phong trào Toàn dân bảo vệ an ninh Tổ quốc',
      'tăng cường công tác quản lý cư trú trên địa bàn',
      'lãnh đạo thực hiện nhiệm vụ chính trị của đơn vị',
      'kiện toàn Ban Chỉ đạo phòng chống tội phạm',
      'triển khai thực hiện Đề án 06 về dữ liệu dân cư',
      'lãnh đạo công tác phòng cháy chữa cháy và cứu nạn cứu hộ',
      'nâng cao hiệu quả công tác tiếp công dân',
      'tăng cường bảo đảm trật tự an toàn giao thông',
    ],
  },
  QD: {
    prefix: 'Về việc',
    periodic: true,
    topics: [
      'thành lập Tổ công tác bảo đảm an ninh trật tự',
      'khen thưởng tập thể, cá nhân có thành tích xuất sắc',
      'phân công nhiệm vụ cán bộ, chiến sĩ',
      'thành lập Hội đồng xét khen thưởng',
      'kiện toàn Tổ tuần tra kiểm soát ban đêm',
      'phê duyệt kế hoạch công tác của đơn vị',
      'điều động cán bộ giữa các đội công tác',
      'thành lập Đoàn kiểm tra công tác phòng cháy chữa cháy',
      'ban hành Quy chế làm việc của đơn vị',
      'cử cán bộ tham gia lớp bồi dưỡng nghiệp vụ',
      'thành lập Tổ xử lý vi phạm hành chính',
    ],
  },
  CT: {
    prefix: 'Về việc tăng cường',
    periodic: true,
    topics: [
      'công tác bảo đảm an ninh trật tự trên địa bàn',
      'các biện pháp phòng ngừa tội phạm trộm cắp tài sản',
      'công tác quản lý vũ khí, vật liệu nổ, công cụ hỗ trợ',
      'công tác phòng chống ma túy trong thanh thiếu niên',
      'kỷ luật, kỷ cương hành chính trong đơn vị',
      'công tác bảo đảm trật tự an toàn giao thông',
      'công tác phòng cháy chữa cháy tại khu dân cư',
      'quản lý ngành nghề kinh doanh có điều kiện',
      'công tác nắm tình hình địa bàn cơ sở',
      'phòng chống tội phạm lừa đảo trên không gian mạng',
      'công tác tiếp nhận, giải quyết tố giác tội phạm',
    ],
  },
  QC: {
    prefix: 'Quy chế',
    periodic: true,
    topics: [
      'làm việc của Công an xã',
      'phối hợp bảo đảm an ninh trật tự với các ban ngành',
      'quản lý và sử dụng tài sản công của đơn vị',
      'tiếp công dân và giải quyết khiếu nại, tố cáo',
      'phối hợp tuần tra kiểm soát với lực lượng an ninh cơ sở',
      'quản lý, sử dụng hồ sơ nghiệp vụ',
      'phát ngôn và cung cấp thông tin cho báo chí',
      'chi tiêu nội bộ của đơn vị',
      'trực ban, trực chiến của đơn vị',
      'bảo vệ bí mật nhà nước trong đơn vị',
      'đánh giá, xếp loại cán bộ chiến sĩ',
    ],
  },
  QYD: {
    prefix: 'Quy định về',
    periodic: true,
    topics: [
      'chế độ trực ban, trực chiến của đơn vị',
      'quản lý và sử dụng con dấu của đơn vị',
      'tiêu chuẩn thi đua, khen thưởng trong đơn vị',
      'trang phục, lễ tiết tác phong của cán bộ chiến sĩ',
      'quản lý, sử dụng phương tiện nghiệp vụ',
      'chế độ báo cáo, thống kê nghiệp vụ',
      'quản lý hồ sơ cán bộ của đơn vị',
      'sử dụng hệ thống camera giám sát an ninh',
      'tiếp nhận và xử lý tin báo tố giác tội phạm',
      'công tác văn thư, lưu trữ của đơn vị',
      'quản lý người tạm trú, tạm vắng trên địa bàn',
    ],
  },
  TC: {
    prefix: 'Thông cáo về',
    periodic: true,
    topics: [
      'kết quả đợt cao điểm tấn công trấn áp tội phạm',
      'tình hình an ninh trật tự trên địa bàn',
      'việc triệt phá ổ nhóm đánh bạc trên địa bàn',
      'kết quả công tác bảo đảm trật tự an toàn giao thông',
      'việc bắt giữ đối tượng truy nã',
      'kết quả kiểm tra công tác phòng cháy chữa cháy',
      'tình hình tội phạm lừa đảo qua mạng',
      'kết quả triển khai cấp căn cước công dân',
      'việc xử lý vụ gây rối trật tự công cộng',
      'kết quả công tác phòng chống ma túy',
      'tình hình trật tự đô thị trên địa bàn',
    ],
  },
  TB: {
    prefix: 'Thông báo về việc',
    periodic: true,
    topics: [
      'phân công lịch trực bảo vệ',
      'tiếp nhận hồ sơ cấp căn cước công dân lưu động',
      'thay đổi thời gian tiếp công dân',
      'kết quả giải quyết đơn thư của công dân',
      'triển khai đợt cao điểm bảo đảm an ninh trật tự',
      'phương thức thủ đoạn hoạt động của tội phạm lừa đảo',
      'tổ chức lấy ý kiến nhân dân về công tác Công an',
      'tạm dừng tiếp nhận hồ sơ để nâng cấp hệ thống',
      'phân luồng giao thông phục vụ lễ hội',
      'kết quả xét khen thưởng của đơn vị',
      'lịch làm việc của bộ phận một cửa',
    ],
  },
  HD: {
    prefix: 'Hướng dẫn',
    periodic: true,
    topics: [
      'công tác đăng ký, quản lý cư trú',
      'thực hiện thủ tục cấp căn cước công dân',
      'công tác lập hồ sơ xử lý vi phạm hành chính',
      'triển khai phong trào Toàn dân bảo vệ an ninh Tổ quốc',
      'nghiệp vụ tuần tra kiểm soát của lực lượng an ninh cơ sở',
      'công tác tiếp nhận tố giác, tin báo về tội phạm',
      'thực hiện chế độ báo cáo nghiệp vụ định kỳ',
      'công tác quản lý ngành nghề kinh doanh có điều kiện',
      'sử dụng phần mềm quản lý hồ sơ điện tử',
      'công tác phòng cháy chữa cháy tại hộ gia đình',
      'quy trình xử lý vụ việc có dấu hiệu tội phạm',
    ],
  },
  CTr: {
    prefix: 'Chương trình',
    periodic: true,
    topics: [
      'công tác trọng tâm của đơn vị',
      'phối hợp bảo đảm an ninh trật tự với Ủy ban nhân dân xã',
      'hành động phòng chống tội phạm và tệ nạn xã hội',
      'tuyên truyền pháp luật cho nhân dân trên địa bàn',
      'kiểm tra công tác phòng cháy chữa cháy',
      'phối hợp với nhà trường bảo đảm an ninh học đường',
      'công tác dân vận của lực lượng Công an',
      'tập huấn nghiệp vụ cho lực lượng an ninh cơ sở',
      'phối hợp bảo đảm trật tự an toàn giao thông',
      'hoạt động kỷ niệm ngày truyền thống lực lượng Công an nhân dân',
      'công tác cải cách hành chính của đơn vị',
    ],
  },
  KH: {
    prefix: 'Kế hoạch',
    periodic: true,
    topics: [
      'bảo đảm an ninh trật tự trên địa bàn',
      'mở đợt cao điểm tấn công trấn áp tội phạm',
      'tổng kiểm tra phòng cháy chữa cháy tại cơ sở kinh doanh',
      'cấp căn cước công dân lưu động cho nhân dân',
      'tuần tra kiểm soát bảo đảm trật tự an toàn giao thông',
      'tuyên truyền phòng chống ma túy trong trường học',
      'rà soát, quản lý đối tượng trên địa bàn',
      'tổ chức diễn tập phương án chữa cháy và cứu nạn cứu hộ',
      'kiểm tra công tác quản lý cư trú',
      'phát động phong trào Toàn dân bảo vệ an ninh Tổ quốc',
      'bồi dưỡng nghiệp vụ cho lực lượng an ninh cơ sở',
    ],
  },
  PA: {
    prefix: 'Phương án',
    periodic: true,
    topics: [
      'bảo đảm an ninh trật tự tại lễ hội trên địa bàn',
      'phòng chống cháy nổ tại chợ trung tâm',
      'bảo vệ mục tiêu trọng điểm trên địa bàn',
      'phân luồng giao thông phục vụ sự kiện',
      'giải quyết tình huống tập trung đông người',
      'cứu nạn cứu hộ khi xảy ra thiên tai',
      'tuần tra kiểm soát ban đêm trên địa bàn',
      'bảo vệ kỳ thi tốt nghiệp trung học phổ thông',
      'phòng chống đua xe trái phép',
      'bảo đảm an ninh trật tự tại khu công nghiệp',
      'xử lý tình huống gây rối trật tự công cộng',
    ],
  },
  DA: {
    prefix: 'Đề án',
    periodic: true,
    topics: [
      'lắp đặt hệ thống camera giám sát an ninh trên địa bàn',
      'xây dựng xã điển hình về phong trào toàn dân bảo vệ ANTQ',
      'nâng cao năng lực lực lượng an ninh cơ sở',
      'chuyển đổi số trong công tác quản lý hồ sơ',
      'phòng chống ma túy tại địa bàn cơ sở',
      'xây dựng mô hình tự quản về an ninh trật tự',
      'cải cách thủ tục hành chính trong lĩnh vực cư trú',
      'bảo đảm trật tự an toàn giao thông đường liên xã',
      'nâng cấp trụ sở làm việc của đơn vị',
      'phát triển ứng dụng công nghệ thông tin trong nghiệp vụ',
      'xây dựng lực lượng Công an xã chính quy',
    ],
  },
  BC: {
    prefix: 'Báo cáo',
    periodic: true,
    topics: [
      'kết quả công tác bảo đảm an ninh trật tự',
      'tình hình tội phạm và vi phạm pháp luật trên địa bàn',
      'kết quả đợt cao điểm tấn công trấn áp tội phạm',
      'công tác quản lý cư trú trên địa bàn',
      'kết quả công tác phòng cháy chữa cháy',
      'tình hình trật tự an toàn giao thông',
      'kết quả tiếp công dân và giải quyết đơn thư',
      'công tác xây dựng phong trào Toàn dân bảo vệ ANTQ',
      'kết quả cấp căn cước công dân trên địa bàn',
      'công tác phòng chống ma túy',
      'kết quả thực hiện Đề án 06 về dữ liệu dân cư',
    ],
  },
  TTr: {
    prefix: 'Tờ trình về việc',
    periodic: true,
    topics: [
      'đề nghị khen thưởng tập thể, cá nhân có thành tích',
      'xin chủ trương lắp đặt camera giám sát an ninh',
      'đề nghị bổ sung biên chế cho đơn vị',
      'xin kinh phí mua sắm trang thiết bị nghiệp vụ',
      'đề nghị phê duyệt kế hoạch công tác của đơn vị',
      'xin chủ trương sửa chữa trụ sở làm việc',
      'đề nghị hỗ trợ kinh phí cho lực lượng an ninh cơ sở',
      'đề nghị điều động, bổ nhiệm cán bộ',
      'xin ý kiến về xử lý vụ việc phức tạp trên địa bàn',
      'đề nghị phê duyệt phương án bảo vệ lễ hội',
      'xin chủ trương tổ chức tập huấn nghiệp vụ',
    ],
  },
  CV: {
    prefix: 'V/v',
    periodic: true,
    topics: [
      'phối hợp bảo đảm an ninh trật tự trên địa bàn',
      'cung cấp thông tin phục vụ công tác điều tra',
      'đề nghị xác minh nhân thân đối tượng',
      'triển khai văn bản chỉ đạo của cấp trên',
      'phối hợp tuyên truyền phòng chống tội phạm',
      'báo cáo tình hình an ninh trật tự đột xuất',
      'đề nghị hỗ trợ lực lượng bảo vệ sự kiện',
      'rà soát, thống kê phương tiện trên địa bàn',
      'phối hợp giải quyết vụ việc tranh chấp đất đai',
      'đôn đốc thực hiện kế hoạch công tác',
      'trao đổi kết quả xác minh đơn thư',
    ],
  },
  GUQ: {
    template: 'Ủy quyền cho {p} {t}',
    periodic: false,
    topics: [
      'ký các văn bản hành chính thông thường của đơn vị',
      'tham dự hội nghị sơ kết công tác Công an',
      'nhận bàn giao trang thiết bị nghiệp vụ',
      'giải quyết công việc của đơn vị trong thời gian đi công tác',
      'làm việc với Ủy ban nhân dân xã về công tác phối hợp',
      'ký hồ sơ đăng ký thường trú, tạm trú',
      'tiếp nhận hồ sơ vụ việc từ đơn vị bạn',
      'đại diện đơn vị dự lễ ra quân đợt cao điểm',
    ],
  },
  GM: {
    template: 'Mời {p} {t}',
    periodic: false,
    topics: [
      'dự họp giao ban công tác của đơn vị',
      'dự hội nghị sơ kết công tác bảo đảm an ninh trật tự',
      'đến làm việc về nội dung đơn thư đã gửi',
      'dự buổi tuyên truyền pháp luật tại khu dân cư',
      'dự lễ ra quân đợt cao điểm tấn công trấn áp tội phạm',
      'đến làm việc về vụ việc đang xác minh',
      'dự tập huấn nghiệp vụ cho lực lượng an ninh cơ sở',
      'dự hội nghị tổng kết phong trào Toàn dân bảo vệ ANTQ',
    ],
  },
  GGT: {
    template: 'Giới thiệu {p} {t}',
    periodic: false,
    topics: [
      'đến liên hệ công tác tại Công an tỉnh',
      'đến liên hệ công tác tại Ủy ban nhân dân xã',
      'đến nhận tài liệu nghiệp vụ tại đơn vị bạn',
      'đến làm việc về công tác quản lý cư trú',
      'tham dự lớp bồi dưỡng nghiệp vụ',
      'đến phối hợp xác minh vụ việc',
      'đến liên hệ công tác tại Viện kiểm sát nhân dân',
      'đến làm việc tại Trung tâm phục vụ hành chính công',
    ],
  },
  GNP: {
    template: 'Nghỉ phép của {p} {t}',
    periodic: false,
    topics: [
      'theo chế độ nghỉ phép năm',
      'về quê giải quyết việc gia đình',
      'để chăm sóc người thân ốm đau',
      'kết hợp khám sức khỏe định kỳ',
      'sau đợt cao điểm công tác',
      'dịp Tết Nguyên đán',
      'vì việc riêng có lý do chính đáng',
      'theo tiêu chuẩn còn tồn của năm trước',
    ],
  },
  DN: {
    template: 'Đề nghị {t} đối với {p}',
    periodic: false,
    topics: [
      'xét khen thưởng do có thành tích trong công tác',
      'hỗ trợ kinh phí thực hiện nhiệm vụ đột xuất',
      'bổ sung trang thiết bị nghiệp vụ cho đơn vị',
      'cử đi đào tạo, bồi dưỡng nâng cao trình độ',
      'xem xét nâng lương trước thời hạn',
      'phối hợp xác minh thông tin phục vụ điều tra',
      'bố trí lực lượng hỗ trợ bảo vệ sự kiện',
      'giải quyết chế độ chính sách theo quy định',
    ],
  },
  NX: {
    template: 'Nhận xét {t} đối với {p}',
    periodic: false,
    topics: [
      'quá trình công tác phục vụ xét khen thưởng',
      'kết quả rèn luyện, công tác trong năm',
      'quá trình công tác phục vụ công tác cán bộ',
      'kết quả thực hiện nhiệm vụ được giao',
      'quá trình học tập tại lớp bồi dưỡng nghiệp vụ',
      'phẩm chất đạo đức, lối sống phục vụ kết nạp Đảng',
      'kết quả thực hiện nhiệm vụ trong đợt cao điểm',
      'quá trình công tác phục vụ đề nghị nâng lương',
    ],
  },
};

/**
 * Trích yếu thứ `i` của một loại: xoay vòng chủ đề, rồi ghép thêm mốc thời
 * gian (loại định kỳ — lấy theo tháng cấp số) hoặc tên người (loại gắn với một
 * con người cụ thể, ghép mốc thời gian vào sẽ đọc rất ngô nghê).
 *
 * `used` giữ các trích yếu đã sinh cho loại đó. Với --per lớn, chủ đề quay
 * vòng nhanh hơn tháng nên hai văn bản có thể ra cùng một câu — thêm hậu tố
 * cho khác nhau, vì trong sổ thật hai số khác nhau không mang cùng trích yếu.
 */
function buildSummary(typeId, i, year, createdAt, used) {
  const c = CONTENT[typeId];
  if (!c) {
    return `Văn bản mẫu số ${i + 1}`;
  }
  const topic = c.topics[i % c.topics.length];
  const round = Math.floor(i / c.topics.length);
  let summary;
  if (c.periodic) {
    const month = new Date(createdAt).getMonth();
    const period = PERIOD_BY_MONTH[month].replace('{year}', year);
    summary = `${c.prefix} ${topic} ${period}`;
  } else {
    // Mỗi loại có trật tự từ riêng ("Mời {người} {việc}" nhưng "Đề nghị {việc}
    // đối với {người}"), nên dùng template chứ không ghép cứng theo một thứ tự.
    const person = PEOPLE[(i + round) % PEOPLE.length];
    summary = c.template.replace('{p}', person).replace('{t}', topic);
  }
  if (used.has(summary)) {
    let n = 2;
    while (used.has(`${summary} (đợt ${n})`)) {
      n++;
    }
    summary = `${summary} (đợt ${n})`;
  }
  used.add(summary);
  return summary;
}

// ---------------------------------------------------------------------------
// Sinh dữ liệu
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { prod: false, clear: false, key: null, per: 22, year: new Date().getFullYear() };
  for (const arg of argv) {
    if (arg === '--prod') {
      opts.prod = true;
    } else if (arg === '--clear') {
      opts.clear = true;
    } else if (arg.startsWith('--key=')) {
      // Tiện hơn biến môi trường GOOGLE_APPLICATION_CREDENTIALS, nhất là trên
      // PowerShell. Ngụ ý --prod: khoá service-account chỉ dùng cho bản thật.
      opts.key = arg.slice(6).replace(/^"|"$/g, '');
      opts.prod = true;
    } else if (arg.startsWith('--per=')) {
      opts.per = Number(arg.slice(6));
    } else if (arg.startsWith('--year=')) {
      opts.year = Number(arg.slice(7));
    } else {
      throw new Error(`Tham số không hợp lệ: "${arg}"`);
    }
  }
  if (!Number.isInteger(opts.per) || opts.per < 1 || opts.per > 200) {
    throw new Error('--per phải là số nguyên trong khoảng 1..200');
  }
  if (!Number.isInteger(opts.year) || opts.year < 2000 || opts.year > 2100) {
    throw new Error('--year phải là một năm hợp lệ');
  }
  return opts;
}

/**
 * Người lấy số: lấy từ tài khoản thật đang có để dữ liệu mẫu trông đúng như
 * app sinh ra. Không có tài khoản nào (emulator trắng) thì dùng người giả.
 */
async function loadAuthors(db) {
  const snap = await db.collection('users').get();
  const real = snap.docs
    .map(d => ({ ...d.data(), uid: d.id }))
    .filter(u => u.active !== false)
    .map(u => ({
      uid: u.uid,
      name: (u.fullName && u.fullName.trim()) || u.displayName || u.email || u.uid,
      unit: u.unit || '',
    }));
  if (real.length) {
    return { authors: real, synthetic: false };
  }
  return {
    synthetic: true,
    authors: PEOPLE.slice(0, 5).map((p, i) => ({
      uid: `seed-user-${i + 1}`,
      name: p.replace('đồng chí ', ''),
      unit: UNITS[i % UNITS.length],
    })),
  };
}

/** Số giả ngẫu nhiên trong [0,1), cố định theo chuỗi đầu vào (chạy lại y hệt). */
/* eslint-disable no-bitwise -- FNV-1a, cần phép toán bit */
function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}
/* eslint-enable no-bitwise */

/**
 * Rải thời điểm lấy số từ 01/01 đến hết năm (hoặc đến hôm nay nếu đang ở trong
 * năm đó). Hai ràng buộc:
 *
 *  - Trong CÙNG một loại, số phải tăng dần theo thời gian: không thể có số 20
 *    cấp trước số 3.
 *  - Giữa các loại thì phải ĐAN XEN. Nếu mọi loại dùng chung một dãy mốc thời
 *    gian thì danh sách "Tất cả loại" xếp theo ngày sẽ ra 21 dòng số 22, rồi
 *    21 dòng số 21 — nhìn là biết dữ liệu bịa. Nên mỗi loại được đẩy lệch pha
 *    (`phase`) và xê dịch ngẫu nhiên (`jitter`) quanh vị trí của nó.
 *
 * Biên độ xê dịch giữ dưới ±0,5 khoảng cách giữa hai số liên tiếp, nên thứ tự
 * trong một loại không bao giờ bị đảo.
 */
function createdAtFor(year, index, total, typeIndex, typeCount, typeId) {
  const start = new Date(year, 0, 2, 8, 0, 0).getTime();
  const endOfYear = new Date(year, 11, 28, 17, 0, 0).getTime();
  const end = Math.min(endOfYear, Date.now() - 3600 * 1000);
  const span = Math.max(end - start, 86400 * 1000);
  const slots = total + 1;
  const phase = typeIndex / typeCount;
  const jitter = (hash01(`${typeId}#${index}`) - 0.5) * 0.8;
  const pos = Math.min(Math.max(index + 1 + phase + jitter, 0.05), slots - 0.05);
  return Math.round(start + (span * pos) / slots);
}

async function commitAll(db, writes) {
  for (let i = 0; i < writes.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + BATCH_LIMIT)) {
      if (w.op === 'delete') {
        batch.delete(w.ref);
      } else {
        batch.set(w.ref, w.data);
      }
    }
    await batch.commit();
  }
}

async function clearSeed(db) {
  // Mọi collection mà seed có đụng vào — bỏ sót một cái là để lại bộ đếm mồ
  // côi, số lấy sau sẽ nhảy lung tung.
  const cols = [
    'doc_numbers',
    'doc_number_counters',
    'doc_number_suffixes',
    'doc_number_options',
  ];
  const writes = [];
  const counts = {};
  for (const col of cols) {
    const snap = await db.collection(col).where('seeded', '==', true).get();
    counts[col] = snap.size;
    writes.push(...snap.docs.map(d => ({ op: 'delete', ref: d.ref })));
  }
  await commitAll(db, writes);
  for (const col of cols) {
    console.log(`  ${col}: xoá ${counts[col]} document`);
  }
  console.log(
    'Các số do người dùng lấy thật (không có cờ seeded) được giữ nguyên.',
  );
}

async function seed(db, opts) {
  const docTypes = loadDocTypes();
  const { authors, synthetic } = await loadAuthors(db);
  if (synthetic) {
    console.log('Chưa có tài khoản nào trong `users` → dùng người lấy số giả lập.');
  } else {
    console.log(`Người lấy số lấy từ ${authors.length} tài khoản thật.`);
  }

  const writes = [];
  for (const [t, type] of docTypes.entries()) {
    const used = new Set();
    for (let i = 0; i < opts.per; i++) {
      const seq = i + 1;
      const author = authors[(t * opts.per + i) % authors.length];
      const unit = UNITS[(t + i) % UNITS.length];
      const createdAt = createdAtFor(opts.year, i, opts.per, t, docTypes.length, type.id);
      // Id cố định → chạy lại script là ghi đè, không nhân đôi dữ liệu mẫu.
      const id = `seed-${opts.year}-${type.id}-${seq}`;
      writes.push({
        op: 'set',
        ref: db.collection('doc_numbers').doc(id),
        data: {
          seq,
          year: opts.year,
          number: formatDocNumber(seq, type.abbr),
          typeId: type.id,
          typeAbbr: type.abbr,
          typeLabel: type.label,
          summary: buildSummary(type.id, i, opts.year, createdAt, used),
          signer: SIGNERS[(t + i) % SIGNERS.length],
          // Đơn vị lấy từ danh mục dùng chung, KHÔNG lấy đơn vị của tài khoản:
          // dropdown trong app chỉ có các tổ này, dữ liệu mẫu mà lệch ra ngoài
          // danh mục thì nhìn như danh mục bị thiếu.
          unit,
          createdBy: author.uid,
          createdByName: author.name,
          createdAt,
          seeded: true,
        },
      });
    }
    // Bộ đếm phải nối tiếp dãy vừa sinh, nếu không số lấy trong app sẽ trùng.
    writes.push({
      op: 'set',
      ref: db.collection('doc_number_counters').doc(`${opts.year}-${type.id}`),
      data: { year: opts.year, typeId: type.id, next: opts.per + 1, seeded: true },
    });

    // Vài văn bản phụ (12A) để tính năng số phụ nhìn thấy được ngay trên dữ
    // liệu mẫu. Bám vào những số ở giữa dãy, và ra đời SAU số gốc — số phụ
    // trong thực tế sinh ra khi văn bản gốc đã phát hành một thời gian.
    for (let k = 0; k < SUFFIXED_PER_TYPE && opts.per >= 4; k++) {
      const baseIdx = Math.floor((opts.per * (k + 1)) / (SUFFIXED_PER_TYPE + 1));
      const baseSeq = baseIdx + 1;
      const author = authors[(t + k) % authors.length];
      const baseCreated = createdAtFor(
        opts.year,
        baseIdx,
        opts.per,
        t,
        docTypes.length,
        type.id,
      );
      writes.push({
        op: 'set',
        ref: db
          .collection('doc_numbers')
          .doc(`seed-${opts.year}-${type.id}-${baseSeq}A`),
        data: {
          seq: baseSeq,
          suffix: 'A',
          year: opts.year,
          number: formatDocNumber(baseSeq, type.abbr, 'A'),
          typeId: type.id,
          typeAbbr: type.abbr,
          typeLabel: type.label,
          summary: `${buildSummary(type.id, baseIdx, opts.year, baseCreated, used)} (bổ sung)`,
          signer: SIGNERS[(t + k) % SIGNERS.length],
          unit: UNITS[(t + k) % UNITS.length],
          createdBy: author.uid,
          createdByName: author.name,
          createdAt: baseCreated + 3 * 86400 * 1000 + k * 3600 * 1000,
          seeded: true,
        },
      });
      writes.push({
        op: 'set',
        ref: db
          .collection('doc_number_suffixes')
          .doc(`${opts.year}-${type.id}-${baseSeq}`),
        data: {
          year: opts.year,
          typeId: type.id,
          seq: baseSeq,
          next: 2,
          seeded: true,
        },
      });
    }
  }

  // Danh mục người ký / đơn vị ban hành dùng chung cho hai dropdown.
  writes.push({
    op: 'set',
    ref: db.collection('doc_number_options').doc('lists'),
    data: {
      signers: SIGNERS,
      units: UNITS,
      updatedAt: Date.now(),
      seeded: true,
    },
  });

  await commitAll(db, writes);
  console.log(
    `\nĐã tạo ${docTypes.length * opts.per} văn bản mẫu ` +
      `(${opts.per} văn bản × ${docTypes.length} loại) cho năm ${opts.year}.`,
  );
  console.log(
    `Kèm ${docTypes.length * SUFFIXED_PER_TYPE} văn bản phụ dạng "12A" ` +
      'và danh mục người ký / đơn vị ban hành.',
  );
  console.log(`Bộ đếm mỗi loại đặt về next = ${opts.per + 1}.`);
  console.log('\nVí dụ vài số đã cấp:');
  for (const type of docTypes.slice(0, 4)) {
    const sample = writes.find(w => w.data?.typeId === type.id);
    console.log(`  ${sample.data.number.padEnd(9)} ${sample.data.summary}`);
  }
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
    console.log(`⚠  Đang ghi vào PROJECT THẬT: ${PROJECT_ID}\n`);
  } else {
    process.env.FIRESTORE_EMULATOR_HOST =
      process.env.FIRESTORE_EMULATOR_HOST || DEFAULT_EMULATOR_HOST;
    admin.initializeApp({ projectId: EMULATOR_PROJECT_ID });
    console.log(
      `Đang ghi vào EMULATOR ${process.env.FIRESTORE_EMULATOR_HOST} ` +
        `(project ${EMULATOR_PROJECT_ID}). Dùng --prod để ghi vào project thật.\n`,
    );
  }

  const db = admin.firestore();
  if (opts.clear) {
    await clearSeed(db);
  } else {
    await seed(db, opts);
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('FAILED:', err.message ?? err);
    process.exit(1);
  });
