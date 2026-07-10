import { initializeApp, getApps } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";
import type { UserMini } from "./types";

export type RealtimeCursor = {
  user: UserMini;
  cursorOffset: number;
  action: string;
  updatedAtMs: number;
};

export type RealtimeDocument = {
  content: string;
  updatedAtMs: number;
  updatedBy: UserMini | null;
  version: number;
};

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

let firestoreInstance: Firestore | null = null;
let authPromise: Promise<void> | null = null;

export function firebaseRealtimeReady() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
}

function firestore() {
  if (!firebaseRealtimeReady()) return null;

  if (!firestoreInstance) {
    const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    firestoreInstance = getFirestore(app);
  }

  return firestoreInstance;
}

async function ensureFirebaseSession() {
  if (!firebaseRealtimeReady()) return false;
  if (!firestore()) return false;
  if (!authPromise) {
    authPromise = signInAnonymously(getAuth(getApps()[0])).then(() => {});
  }

  await authPromise;
  return true;
}

function documentRef(projectId: string) {
  const db = firestore();
  return db ? doc(db, "projectDocuments", projectId) : null;
}

function presenceRef(projectId: string, userId: string) {
  const db = firestore();
  return db ? doc(db, "projectDocuments", projectId, "presence", userId) : null;
}

export async function subscribeRealtimeDocument(
  projectId: string,
  onDocument: (document: RealtimeDocument) => void,
  onCursors: (cursors: RealtimeCursor[]) => void
) {
  await ensureFirebaseSession();

  const db = firestore();
  const realtimeDocumentRef = documentRef(projectId);
  if (!db || !realtimeDocumentRef) return null;

  const unsubscribes: Unsubscribe[] = [
    onSnapshot(realtimeDocumentRef, (snapshot) => {
      if (!snapshot.exists()) return;

      const data = snapshot.data();
      onDocument({
        content: typeof data.content === "string" ? data.content : "",
        updatedAtMs: Number(data.updatedAtMs || 0),
        updatedBy: (data.updatedBy || null) as UserMini | null,
        version: Number(data.version || 0),
      });
    }),
    onSnapshot(collection(db, "projectDocuments", projectId, "presence"), (snapshot) => {
      const now = Date.now();
      const cursors = snapshot.docs
        .map((item) => item.data() as RealtimeCursor)
        .filter((cursor) => cursor.user?.id && now - Number(cursor.updatedAtMs || 0) < 12000);

      onCursors(cursors);
    }),
  ];

  return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
}

export async function saveRealtimeDocument(projectId: string, content: string, user: UserMini | null) {
  await ensureFirebaseSession();

  const realtimeDocumentRef = documentRef(projectId);
  if (!realtimeDocumentRef) return false;

  await setDoc(
    realtimeDocumentRef,
    {
      content,
      updatedAt: serverTimestamp(),
      updatedAtMs: Date.now(),
      updatedBy: user,
      version: Date.now(),
    },
    { merge: true }
  );

  return true;
}

export async function ensureRealtimeDocument(projectId: string, content: string, user: UserMini | null) {
  await ensureFirebaseSession();

  const realtimeDocumentRef = documentRef(projectId);
  if (!realtimeDocumentRef) return false;

  const snapshot = await getDoc(realtimeDocumentRef);
  if (snapshot.exists()) return true;

  return saveRealtimeDocument(projectId, content, user);
}

export async function saveRealtimeCursor(projectId: string, user: UserMini | null, cursorOffset: number) {
  if (!user?.id) return false;
  await ensureFirebaseSession();

  const realtimePresenceRef = presenceRef(projectId, user.id);
  if (!realtimePresenceRef) return false;

  await setDoc(
    realtimePresenceRef,
    {
      user,
      cursorOffset,
      action: "editando",
      updatedAt: serverTimestamp(),
      updatedAtMs: Date.now(),
    },
    { merge: true }
  );

  return true;
}

export async function clearRealtimeCursor(projectId: string, userId?: string) {
  if (!userId) return;
  await ensureFirebaseSession();

  const realtimePresenceRef = presenceRef(projectId, userId);
  if (realtimePresenceRef) await deleteDoc(realtimePresenceRef).catch(() => {});
}
