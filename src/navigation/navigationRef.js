import { createNavigationContainerRef } from '@react-navigation/native';

/**
 * Ref của NavigationContainer, để chuyển màn hình từ chỗ không có prop
 * `navigation` (ví dụ IncomingDutyFileListener nằm ngoài Tab.Navigator).
 */
export const navigationRef = createNavigationContainerRef();
