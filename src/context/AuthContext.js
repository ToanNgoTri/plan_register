import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { onAuthStateChanged } from '@react-native-firebase/auth';
import { auth } from '../services/firebase';
import {
  ensureUserProfile,
  subscribeToProfile,
  updateFcmToken,
} from '../services/userService';
import {
  configureGoogleSignin,
  signInWithGoogle,
  signOut as doSignOut,
} from '../services/authService';
import {
  cancelAllReminders,
  getFcmToken,
  scheduleWeekdayReminders,
  setupNotifications,
} from '../services/notificationService';
const AuthContext = createContext(undefined);
export function AuthProvider({ children }) {
  const [initializing, setInitializing] = useState(true);
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState(null);
  const profileUnsub = useRef(null);

  // Configure Google Sign-In + notifications once.
  useEffect(() => {
    configureGoogleSignin();
    setupNotifications().catch(() => {});
  }, []);

  // Load (and live-subscribe to) the Firestore profile for a signed-in user.
  const loadProfile = useCallback(async user => {
    profileUnsub.current?.();
    profileUnsub.current = null;
    setProfileError(null);
    try {
      await ensureUserProfile({
        uid: user.uid,
        email: user.email ?? '',
        displayName: user.displayName ?? '',
        photoURL: user.photoURL,
      });
    } catch (e) {
      // e.g. Firestore not created, or rules deny the read/write.
      setProfileError(e);
      setInitializing(false);
      return;
    }
    profileUnsub.current = subscribeToProfile(
      user.uid,
      p => {
        setProfile(p);
        setProfileError(
          p ? null : new Error('Không tìm thấy hồ sơ người dùng.'),
        );
        setInitializing(false);
      },
      err => {
        setProfileError(err);
        setInitializing(false);
      },
    );
  }, []);

  // React to Firebase auth changes.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, user => {
      setFirebaseUser(user);
      if (!user) {
        profileUnsub.current?.();
        profileUnsub.current = null;
        setProfile(null);
        setProfileError(null);
        setInitializing(false);
        cancelAllReminders().catch(() => {});
        return;
      }
      loadProfile(user);
    });
    return () => {
      unsub();
      profileUnsub.current?.();
    };
  }, [loadProfile]);
  const retryProfile = useCallback(() => {
    const user = auth.currentUser;
    if (user) {
      setInitializing(true);
      loadProfile(user);
    }
  }, [loadProfile]);
  const isBoss = profile?.role === 'boss';
  const isApproved = !!profile?.approved;
  // Older docs created before the `active` field default to active.
  const isActive = profile ? profile.active !== false : false;

  // Side effects that depend on the resolved profile.
  useEffect(() => {
    if (!profile) {
      return;
    }
    // Persist FCM token (best effort, for future server-side push).
    getFcmToken()
      .then(token => {
        if (token && token !== profile.fcmToken) {
          updateFcmToken(profile.uid, token).catch(() => {});
        }
      })
      .catch(() => {});

    // Only approved & active staff get the daily reminders. Bosses never
    // register; deactivated users are locked out.
    if (
      profile.role === 'staff' &&
      profile.approved &&
      profile.active !== false
    ) {
      scheduleWeekdayReminders().catch(() => {});
    } else {
      cancelAllReminders().catch(() => {});
    }
  }, [profile]);
  const signIn = useCallback(async () => {
    await signInWithGoogle();
  }, []);
  const signOut = useCallback(async () => {
    await cancelAllReminders().catch(() => {});
    await doSignOut();
  }, []);
  const value = useMemo(
    () => ({
      initializing,
      firebaseUser,
      profile,
      profileError,
      isBoss,
      isApproved,
      isActive,
      signIn,
      signOut,
      retryProfile,
    }),
    [
      initializing,
      firebaseUser,
      profile,
      profileError,
      isBoss,
      isApproved,
      isActive,
      signIn,
      signOut,
      retryProfile,
    ],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
