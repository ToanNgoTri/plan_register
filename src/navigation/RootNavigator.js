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
import ManageUsersScreen from '../screens/ManageUsersScreen';
import InactiveScreen from '../screens/InactiveScreen';
import ProfileErrorScreen from '../screens/ProfileErrorScreen';
import SettingsScreen from '../screens/SettingsScreen';
import BossAlertListener from '../components/BossAlertListener';
import { displayNameOf } from '../services/userService';
import { colors } from '../theme';
const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

/** Header greeting (left side): "Xin chào, [HỌ TÊN]" for the signed-in user. */
function HeaderGreeting() {
  const { profile } = useAuth();
  const name = profile ? displayNameOf(profile) : '';
  return (
    <Text
      numberOfLines={1}
      style={{
        color: '#fff',
        fontWeight: '600',
        fontSize: 16,
        paddingLeft: 16,
        maxWidth: 260,
      }}
    >
      Xin chào, {name.toUpperCase()}
    </Text>
  );
}
const tabIcon = emoji => () =>
  (
    <Text
      style={{
        fontSize: 20,
      }}
    >
      {emoji}
    </Text>
  );
const screenOptions = {
  headerStyle: {
    backgroundColor: colors.primary,
  },
  headerTintColor: '#fff',
  // Greeting on the left; the screen title is hidden (the tab bar already shows
  // the tab name at the bottom).
  headerTitle: () => null,
  headerLeft: () => <HeaderGreeting />,
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
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
});
