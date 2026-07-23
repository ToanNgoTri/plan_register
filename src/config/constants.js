/**
 * App-wide configuration.
 *
 * IMPORTANT: replace WEB_CLIENT_ID with the "Web client (auto created by
 * Google Service)" OAuth 2.0 client ID from the Firebase console:
 *   Firebase Console → Authentication → Sign-in method → Google → Web SDK
 *   configuration → Web client ID
 * (It is the same value found in google-services.json under
 *  client[].oauth_client[] with client_type == 3.)
 */
export const WEB_CLIENT_ID =
  '811727600503-s8qc79js99cfth5k4bl93vc4qk0s85ef.apps.googleusercontent.com';

/** Hour (24h, device local time) at which staff get the daily reminder. */
export const REMINDER_HOUR = 8;
export const REMINDER_MINUTE = 0;

/** Notifee channel id used for the daily reminder + boss alerts (Android). */
export const ANDROID_CHANNEL_ID = 'plan-register-default';

/**
 * Chức vụ (job title / rank) options a user can pick for their profile.
 *
 * NOTE: the `BOSS_POSITION` chức vụ grants boss permissions on its own —
 * anyone whose position is "Trưởng CA" is treated as a boss (full management +
 * approval), regardless of the stored `role`. Keep this string in sync with
 * the same literal in firestore.rules.
 */
export const POSITIONS = ['Trưởng CA', 'Phó Trưởng CA', 'Cán bộ'];
export const BOSS_POSITION = 'Trưởng CA';
