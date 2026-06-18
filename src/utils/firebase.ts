// firebase-admin/auth uses jwks-rsa → jose (ESM-only), which crashes CJS require() at startup.
// Fix: lazy dynamic imports so the modules only load on first actual use, not at module load time.

import type { App } from 'firebase-admin/app';

let app: App | undefined;

async function getFirebaseApp(): Promise<App> {
  if (!app) {
    const { initializeApp, getApps, cert } = await import('firebase-admin/app');
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

export async function getMessaging() {
  const { getMessaging: _get } = await import('firebase-admin/messaging');
  return _get(await getFirebaseApp());
}

export async function getFirebaseAuth() {
  const { getAuth: _get } = await import('firebase-admin/auth');
  return _get(await getFirebaseApp());
}
