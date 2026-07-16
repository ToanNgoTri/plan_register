/**
 * Central Firebase handles. react-native-firebase auto-initializes the default
 * app from the native config files (google-services.json /
 * GoogleService-Info.plist), so there is no JS initializeApp() call here.
 */
import { getApp } from '@react-native-firebase/app';
import { getAuth } from '@react-native-firebase/auth';
import { getFirestore } from '@react-native-firebase/firestore';
import { getMessaging } from '@react-native-firebase/messaging';
export const app = getApp();
export const auth = getAuth(app);
export const db = getFirestore(app);
export const messaging = getMessaging(app);
