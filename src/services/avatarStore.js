import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Local (on-device) avatar storage. Avatars are kept out of Firestore entirely:
 * the user's chosen photo is stored as a base64 data URI in AsyncStorage, keyed
 * by uid, so it lives on the local file system and never leaves the device.
 */
const keyFor = uid => `avatar:${uid}`;

/** Returns the stored data-URI for this user, or null if none set. */
export async function getAvatar(uid) {
  if (!uid) {
    return null;
  }
  try {
    return await AsyncStorage.getItem(keyFor(uid));
  } catch {
    return null;
  }
}

/** Persist a data-URI (e.g. "data:image/jpeg;base64,...") for this user. */
export async function setAvatar(uid, dataUri) {
  if (!uid) {
    return;
  }
  await AsyncStorage.setItem(keyFor(uid), dataUri);
}

/** Remove the stored avatar for this user. */
export async function clearAvatar(uid) {
  if (!uid) {
    return;
  }
  try {
    await AsyncStorage.removeItem(keyFor(uid));
  } catch {
    // best effort
  }
}
