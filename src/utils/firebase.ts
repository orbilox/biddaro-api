import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getMessaging as _getMessaging } from 'firebase-admin/messaging';
import { getAuth as _getAuth } from 'firebase-admin/auth';

let app: App | undefined;

function getFirebaseApp(): App {
  if (!app) {
    app = getApps().length
      ? getApps()[0]!
      : initializeApp({
          credential: cert({
            projectId:   process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
          }),
        });
  }
  return app!;
}

export function getMessaging() {
  return _getMessaging(getFirebaseApp());
}

export function getFirebaseAuth() {
  return _getAuth(getFirebaseApp());
}
