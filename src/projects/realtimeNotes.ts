import { onDisconnect, onValue, ref, remove, serverTimestamp, set, type Unsubscribe } from "firebase/database";
import { realtimeDatabase } from "../firebase";
import type { ProjectNoteDraft, UserMini } from "./types";

const draftMaxAgeMs = 12000;
const disconnectRegistrations = new Set<string>();

type DraftInput = {
  projectId: string;
  taskId: string;
  user: UserMini;
  message: string;
  cursorIndex: number;
};

function cleanKey(value: string) {
  return value.replace(/[.#$]/g, "_").split("/").join("_").split("[").join("_").split("]").join("_");
}

function projectDraftsPath(projectId: string) {
  return `projectNoteDrafts/${cleanKey(projectId)}`;
}

function taskDraftPath(projectId: string, taskId: string, userId: string) {
  return `${projectDraftsPath(projectId)}/${cleanKey(taskId)}/${cleanKey(userId)}`;
}

function normalizeDraft(value: unknown): ProjectNoteDraft | null {
  if (!value || typeof value !== "object") return null;

  const item = value as {
    user?: UserMini;
    message?: string;
    cursorIndex?: number;
    updatedAt?: number;
  };

  if (!item.user?.id || typeof item.message !== "string") return null;
  if (Date.now() - Number(item.updatedAt || 0) > draftMaxAgeMs) return null;

  return {
    user: item.user,
    message: item.message,
    cursorIndex: Number.isFinite(item.cursorIndex) ? Number(item.cursorIndex) : item.message.length,
    updatedAt: item.updatedAt,
  };
}

export function watchRealtimeProjectNoteDrafts(
  projectId: string,
  currentUserId: string,
  onChange: (draftsByTask: Record<string, ProjectNoteDraft[]>) => void
): Unsubscribe {
  if (!realtimeDatabase || !projectId || !currentUserId) {
    onChange({});
    return () => {};
  }

  return onValue(
    ref(realtimeDatabase, projectDraftsPath(projectId)),
    (snapshot) => {
      const tasks = snapshot.val() || {};
      const next: Record<string, ProjectNoteDraft[]> = {};

      for (const [taskId, users] of Object.entries(tasks)) {
        const drafts = Object.values(users as Record<string, unknown>)
          .map(normalizeDraft)
          .filter((draft): draft is ProjectNoteDraft => Boolean(draft && draft.user.id !== currentUserId && draft.message.trim()));

        if (drafts.length) next[taskId] = drafts;
      }

      onChange(next);
    },
    () => onChange({})
  );
}

export function publishRealtimeTaskNoteDraft({ projectId, taskId, user, message, cursorIndex }: DraftInput) {
  if (!realtimeDatabase || !projectId || !taskId || !user.id) return false;

  const draftRef = ref(realtimeDatabase, taskDraftPath(projectId, taskId, user.id));
  const registrationKey = `${projectId}:${taskId}:${user.id}`;
  if (!disconnectRegistrations.has(registrationKey)) {
    disconnectRegistrations.add(registrationKey);
    void onDisconnect(draftRef).remove().catch(() => {
      disconnectRegistrations.delete(registrationKey);
    });
  }

  void set(draftRef, {
    user,
    message,
    cursorIndex: Math.min(Math.max(cursorIndex, 0), message.length),
    updatedAt: serverTimestamp(),
  }).catch(() => {});

  return true;
}

export function clearRealtimeTaskNoteDraft(projectId: string, taskId: string, userId: string) {
  if (!realtimeDatabase || !projectId || !taskId || !userId) return false;

  disconnectRegistrations.delete(`${projectId}:${taskId}:${userId}`);
  void remove(ref(realtimeDatabase, taskDraftPath(projectId, taskId, userId)));
  return true;
}
