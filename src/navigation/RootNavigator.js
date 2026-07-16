import React from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
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
import BossAlertListener from '../components/BossAlertListener';
import { colors } from '../theme';
const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
function SignOutButton() {
  const { signOut } = useAuth();
  const onPress = () =>
    Alert.alert('Đăng xuất', 'Bạn có chắc muốn đăng xuất?', [
      {
        text: 'Huỷ',
        style: 'cancel',
      },
      {
        text: 'Đăng xuất',
        style: 'destructive',
        onPress: () => signOut(),
      },
    ]);
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
      }}
    >
      <Text
        style={{
          color: '#fff',
          fontWeight: '600',
        }}
      >
        Đăng xuất
      </Text>
    </TouchableOpacity>
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
  headerRight: () => <SignOutButton />,
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
    </Tab.Navigator>
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
  } else if (!isBoss && !isApproved) {
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
  } else if (!isBoss && !isActive) {
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
    content = isBoss ? <BossTabs /> : <StaffTabs />;
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
