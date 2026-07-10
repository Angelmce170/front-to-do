import { onDisconnect, onValue, ref, remove, serverTimestamp, set, type Unsubscribe } from "firebase/database";
import { isFirebaseRealtimeReady, realtimeDatabase } from "../firebase";
import type { ProjectPresence, UserMini } from "./types";

const presenceMaxAgeMs = 12000;
const disconnectRegistrations = new Set<string>();

type PresenceInput = {
  projectId: string;
  user: UserMini;
  area: string;
  action: string;
  cursor?: { x: number; y: number } | null;
};

function cleanKey(value: string) {
  return value.replace(/[.#$]/g, "_").split("/").join("_").split("[").join("_").split("]").join("_");
}

function projectPresencePath(projectId: string) {
  return `projectPresence/${cleanKey(projectId)}`;
}

function userPresencePath(projectId: string, userId: string) {
  return `${projectPresencePath(projectId)}/${cleanKey(userId)}`;
}

function normalizePresence(value: unknown): ProjectPresence | null {
  if (!value || typeof value !== "object") return null;

  const item = value as {
    user?: UserMini;
    area?: string;
    action?: string;
    cursorX?: number;
    cursorY?: number;
    updatedAt?: number;
  };

  if (!item.user?.id || !item.area || !item.action) return null;
  if (Date.now() - Number(item.updatedAt || 0) > presenceMaxAgeMs) return null;

  return {
    user: item.user,
    area: item.area,
    action: item.action,
    cursorX: typeof item.cursorX === "number" ? item.cursorX : null,
    cursorY: typeof item.cursorY === "number" ? item.cursorY : null,
  };
}

export function realtimePresenceReady() {
  return isFirebaseRealtimeReady();
}

export function watchRealtimeProjectPresence(
  projectId: string,
  currentUserId: string,
  onChange: (presence: ProjectPresence[]) => void
): Unsubscribe {
  if (!realtimeDatabase || !projectId || !currentUserId) {
    onChange([]);
    return () => {};
  }

  return onValue(
    ref(realtimeDatabase, projectPresencePath(projectId)),
    (snapshot) => {
      const values = snapshot.val() || {};
      const presence = Object.values(values)
        .map(normalizePresence)
        .filter((item): item is ProjectPresence => Boolean(item?.user?.id && item.user.id !== currentUserId));

      onChange(presence);
    },
    () => onChange([])
  );
}

export function publishRealtimeProjectPresence({ projectId, user, area, action, cursor }: PresenceInput) {
  if (!realtimeDatabase || !projectId || !user.id) return false;

  const userRef = ref(realtimeDatabase, userPresencePath(projectId, user.id));
  const registrationKey = `${projectId}:${user.id}`;
  if (!disconnectRegistrations.has(registrationKey)) {
    disconnectRegistrations.add(registrationKey);
    void onDisconnect(userRef).remove().catch(() => {
      disconnectRegistrations.delete(registrationKey);
    });
  }

  void set(userRef, {
    user,
    area,
    action,
    cursorX: cursor?.x ?? null,
    cursorY: cursor?.y ?? null,
    updatedAt: serverTimestamp(),
  }).catch(() => {});

  return true;
}

export function clearRealtimeProjectPresence(projectId: string, userId: string) {
  if (!realtimeDatabase || !projectId || !userId) return false;

  disconnectRegistrations.delete(`${projectId}:${userId}`);
  void remove(ref(realtimeDatabase, userPresencePath(projectId, userId)));
  return true;
}
