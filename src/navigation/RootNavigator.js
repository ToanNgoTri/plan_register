import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuth } from '../context/AuthContext';
import LoginScreen from '../screens/LoginScreen';
import PendingApprovalScreen from '../screens/PendingApprovalScreen';
import RegisterPlanScreen from '../screens/RegisterPlanScreen';
import DashboardScreen from '../screens/DashboardScreen';
import HistoryScreen from '../screens/HistoryScreen';
import DutyScheduleScreen from '../screens/DutyScheduleScreen';
import DocNumberScreen from '../screens/DocNumberScreen';
import ManageUsersScreen from '../screens/ManageUsersScreen';
import InactiveScreen from '../screens/InactiveScreen';
import ProfileErrorScreen from '../screens/ProfileErrorScreen';
import SettingsScreen from '../screens/SettingsScreen';
import BossAlertListener from '../components/BossAlertListener';
import { displayNameOf } from '../services/userService';
import { colors } from '../theme';
const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

/**
 * Header greeting: "Xin chào, [HỌ TÊN]" của người đang đăng nhập.
 *
 * Nằm ở ô TIÊU ĐỀ, không phải ô bên trái. Navigator tính sẵn `maxWidth` cho ô
 * tiêu đề bằng gần hết bề ngang máy, còn ô bên trái thì co đúng bằng nội dung —
 * nên trước phải tự chặn cứng `maxWidth: 260` và họ tên dài bị cắt mất.
 *
 * Cho phép 2 dòng: hai dòng `lineHeight` 18 cao 36dp, vẫn nằm gọn trong chiều
 * cao header (56dp Android / 44dp iOS), nên họ tên bốn năm chữ vẫn hiện đủ thay
 * vì bị "…". Không đặt `paddingLeft` nữa: ô tiêu đề đã có sẵn lề 16dp.
 */
function HeaderGreeting() {
  const { profile } = useAuth();
  const name = profile ? displayNameOf(profile) : '';
  return (
    <Text
      numberOfLines={2}
      // Người dùng đặt cỡ chữ hệ thống lớn thì hai dòng sẽ tràn khỏi header
      // (iOS chỉ cao 44dp), nên chặn mức phóng ở 1.2: 2 x 18 x 1.2 = 43dp.
      maxFontSizeMultiplier={1.2}
      style={styles.greeting}
    >
      Xin chào, {name.toUpperCase()}
    </Text>
  );
}
const tabIcon = emoji => () => <Text style={styles.tabIcon}>{emoji}</Text>;
const screenOptions = {
  headerStyle: {
    backgroundColor: colors.primary,
  },
  headerTintColor: '#fff',
  // Lời chào chiếm luôn ô tiêu đề — tên màn hình không cần hiện ở đây vì thanh
  // tab dưới đã ghi. Canh trái trên CẢ HAI nền tảng: mặc định iOS canh giữa,
  // mà ô tiêu đề canh giữa chỉ được một nửa bề ngang nên lại cắt chữ.
  headerTitleAlign: 'left',
  headerTitle: () => <HeaderGreeting />,
  tabBarActiveTintColor: colors.primary,
};
function BossTabs() {
  return (
    <>
      <BossAlertListener />
      <Tab.Navigator screenOptions={screenOptions}>
        <Tab.Screen
          name="Dashboard"
          component={DashboardScreen}
          options={{
            title: 'Tổng quan',
            tabBarIcon: tabIcon('📊'),
          }}
        />
        <Tab.Screen
          name="Duty"
          component={DutyScheduleScreen}
          options={{
            title: 'Lịch trực',
            tabBarIcon: tabIcon('🛡️'),
          }}
        />
        <Tab.Screen
          name="DocNumbers"
          component={DocNumberScreen}
          options={{
            title: 'Số VB',
            tabBarIcon: tabIcon('🔢'),
          }}
        />
        <Tab.Screen
          name="History"
          component={HistoryScreen}
          options={{
            title: 'Lịch sử',
            tabBarIcon: tabIcon('🗓️'),
          }}
        />
        <Tab.Screen
          name="ManageUsers"
          component={ManageUsersScreen}
          options={{
            title: 'Người dùng',
            tabBarIcon: tabIcon('👥'),
          }}
        />
        <Tab.Screen
          name="Settings"
          component={SettingsScreen}
          options={{
            title: 'Cài đặt',
            tabBarIcon: tabIcon('⚙️'),
          }}
        />
      </Tab.Navigator>
    </>
  );
}
function StaffTabs() {
  return (
    <Tab.Navigator screenOptions={screenOptions}>
      <Tab.Screen
        name="Register"
        component={RegisterPlanScreen}
        options={{
          title: 'Đăng ký',
          tabBarIcon: tabIcon('📝'),
        }}
      />
      <Tab.Screen
        name="Duty"
        component={DutyScheduleScreen}
        options={{
          title: 'Lịch trực',
          tabBarIcon: tabIcon('🛡️'),
        }}
      />
      <Tab.Screen
        name="DocNumbers"
        component={DocNumberScreen}
        options={{
          title: 'Số VB',
          tabBarIcon: tabIcon('🔢'),
        }}
      />
      <Tab.Screen
        name="History"
        component={HistoryScreen}
        options={{
          title: 'Lịch sử',
          tabBarIcon: tabIcon('🗓️'),
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          title: 'Cài đặt',
          tabBarIcon: tabIcon('⚙️'),
        }}
      />
    </Tab.Navigator>
  );
}

// `dev` (review/demo) role: the staff experience (register + history) PLUS the
// user-management/approval screen. Lets an App Review account exercise every
// feature from one login.
function DevTabs() {
  return (
    <>
      <BossAlertListener />
      <Tab.Navigator screenOptions={screenOptions}>
        <Tab.Screen
          name="Register"
          component={RegisterPlanScreen}
          options={{
            title: 'Đăng ký',
            tabBarIcon: tabIcon('📝'),
          }}
        />
        <Tab.Screen
          name="Duty"
          component={DutyScheduleScreen}
          options={{
            title: 'Lịch trực',
            tabBarIcon: tabIcon('🛡️'),
          }}
        />
        <Tab.Screen
          name="DocNumbers"
          component={DocNumberScreen}
          options={{
            title: 'Số VB',
            tabBarIcon: tabIcon('🔢'),
          }}
        />
        <Tab.Screen
          name="History"
          component={HistoryScreen}
          options={{
            title: 'Lịch sử',
            tabBarIcon: tabIcon('🗓️'),
          }}
        />
        <Tab.Screen
          name="ManageUsers"
          component={ManageUsersScreen}
          options={{
            title: 'Phê duyệt',
            tabBarIcon: tabIcon('👥'),
          }}
        />
        <Tab.Screen
          name="Settings"
          component={SettingsScreen}
          options={{
            title: 'Cài đặt',
            tabBarIcon: tabIcon('⚙️'),
          }}
        />
      </Tab.Navigator>
    </>
  );
}
function Splash() {
  return (
    <View style={styles.splash}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}
export default function RootNavigator() {
  const {
    initializing,
    firebaseUser,
    profile,
    profileError,
    isBoss,
    isDev,
    isApproved,
    isActive,
  } = useAuth();
  let content;
  if (initializing) {
    content = <Splash />;
  } else if (!firebaseUser) {
    content = (
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
        }}
      >
        <Stack.Screen name="Login" component={LoginScreen} />
      </Stack.Navigator>
    );
  } else if (!profile) {
    // Signed in, but profile not loaded: show the error (with retry) if we
    // captured one, otherwise we are still loading.
    content = profileError ? (
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
        }}
      >
        <Stack.Screen name="ProfileError" component={ProfileErrorScreen} />
      </Stack.Navigator>
    ) : (
      <Splash />
    );
  } else if (!isBoss && !isDev && !isApproved) {
    // Signed in staff, not yet approved → locked out of all features.
    content = (
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
        }}
      >
        <Stack.Screen name="Pending" component={PendingApprovalScreen} />
      </Stack.Navigator>
    );
  } else if (!isBoss && !isDev && !isActive) {
    // Approved but deactivated (e.g. moved elsewhere) → locked out.
    content = (
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
        }}
      >
        <Stack.Screen name="Inactive" component={InactiveScreen} />
      </Stack.Navigator>
    );
  } else {
    content = isBoss ? <BossTabs /> : isDev ? <DevTabs /> : <StaffTabs />;
  }
  return <NavigationContainer>{content}</NavigationContainer>;
}
const styles = StyleSheet.create({
  greeting: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
    // Hai dòng phải vừa chiều cao header (44dp iOS / 56dp Android), nên không
    // dùng lineHeight mặc định.
    lineHeight: 18,
  },
  tabIcon: {
    fontSize: 20,
  },
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
});
