const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const defaultConfig = getDefaultConfig(__dirname);

/**
 * Thư mục sản phẩm build native. Không có file JS nào trong đó, nhưng Metro vẫn
 * theo dõi cả cây dự án.
 *
 * Trên Windows không có watchman nên Metro dùng watcher dự phòng: nó gọi
 * fs.watch cho từng thư mục con. Gradle/CMake tạo rồi xoá thư mục tạm
 * (android/app/.cxx/.../CMakeFiles/CMakeTmp) trong lúc build, watcher bám vào
 * một thư mục vừa biến mất và ném ENOENT làm sập cả tiến trình Metro:
 *
 *   Error: ENOENT: no such file or directory, watch '...\CMakeFiles\CMakeTmp\CMakeFiles'
 *
 * `npx react-native run-android` chạy Metro rồi build gradle ngay sau đó nên
 * dính đúng bẫy này. Chặn các thư mục build khỏi danh sách theo dõi là xong.
 */
const buildDirs = [
  'android/app/.cxx',
  'android/app/build',
  'android/build',
  'android/.gradle',
  'ios/build',
  'ios/Pods',
];

const buildDirPattern = new RegExp(
  `^(${buildDirs
    .map(dir =>
      path.resolve(__dirname, dir).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('|')})[\\\\/]`,
);

// Giữ nguyên blockList mặc định của React Native rồi thêm phần của mình —
// mergeConfig THAY THẾ trường này chứ không gộp, đặt thẳng sẽ mất bản gốc.
const defaultBlockList = defaultConfig.resolver.blockList;
const blockList = defaultBlockList
  ? [].concat(defaultBlockList, buildDirPattern)
  : buildDirPattern;

module.exports = mergeConfig(defaultConfig, {
  resolver: { blockList },
});
