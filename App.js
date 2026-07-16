import React from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/context/AuthContext';
import RootNavigator from './src/navigation/RootNavigator';
import ForceUpdateGate from './src/components/ForceUpdateGate';
import { colors } from './src/theme';
export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar
        barStyle="light-content"
        backgroundColor={colors.primaryDark}
      />
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
      {/* Mandatory-update gate, overlays everything when a new version exists. */}
      <ForceUpdateGate />
    </SafeAreaProvider>
  );
}
