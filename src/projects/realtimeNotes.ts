import { onDisconnect, onValue, ref, remove, serverTimestamp, set, type Unsubscribe } from "firebase/database";
import { realtimeDatabase } from "../firebase";
import type { ProjectNoteDraft, ProjectSharedNoteDraft, UserMini } from "./types";

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

function projectSharedDraftsPath(projectId: string) {
  return `projectSharedNoteDrafts/${cleanKey(projectId)}`;
}

function taskDraftPath(projectId: string, taskId: string, userId: string) {
  return `${projectDraftsPath(projectId)}/${cleanKey(taskId)}/${cleanKey(userId)}`;
}

function sharedTaskDraftPath(projectId: string, taskId: string) {
  return `${projectSharedDraftsPath(projectId)}/${cleanKey(taskId)}`;
}

function sharedTaskEditorPath(projectId: string, taskId: string, userId: string) {
  return `${sharedTaskDraftPath(projectId, taskId)}/editors/${cleanKey(userId)}`;
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

export function watchRealtimeProjectSharedNoteDrafts(
  projectId: string,
  currentUserId: string,
  onChange: (draftsByTask: Record<string, ProjectSharedNoteDraft>) => void
): Unsubscribe {
  if (!realtimeDatabase || !projectId || !currentUserId) {
    onChange({});
    return () => {};
  }

  return onValue(
    ref(realtimeDatabase, projectSharedDraftsPath(projectId)),
    (snapshot) => {
      const tasks = snapshot.val() || {};
      const next: Record<string, ProjectSharedNoteDraft> = {};

      for (const [taskId, value] of Object.entries(tasks)) {
        const item = value as {
          content?: { message?: string; updatedAt?: number };
          editors?: Record<string, unknown>;
        };
        const message = typeof item.content?.message === "string" ? item.content.message : "";
        const editors = Object.values(item.editors || {})
          .map(normalizeDraft)
          .filter((draft): draft is ProjectNoteDraft => Boolean(draft && draft.user.id !== currentUserId));

        if (message.trim() || editors.length) {
          next[taskId] = {
            message,
            editors,
            updatedAt: item.content?.updatedAt,
          };
        }
      }

      onChange(next);
    },
    () => onChange({})
  );
}

export function publishRealtimeSharedTaskNoteDraft({ projectId, taskId, user, message, cursorIndex }: DraftInput) {
  if (!realtimeDatabase || !projectId || !taskId || !user.id) return false;

  const contentRef = ref(realtimeDatabase, `${sharedTaskDraftPath(projectId, taskId)}/content`);
  const editorRef = ref(realtimeDatabase, sharedTaskEditorPath(projectId, taskId, user.id));
  const registrationKey = `shared:${projectId}:${taskId}:${user.id}`;
  if (!disconnectRegistrations.has(registrationKey)) {
    disconnectRegistrations.add(registrationKey);
    void onDisconnect(editorRef).remove().catch(() => {
      disconnectRegistrations.delete(registrationKey);
    });
  }

  void set(contentRef, {
    message,
    updatedAt: serverTimestamp(),
  }).catch(() => {});
  void set(editorRef, {
    user,
    message,
    cursorIndex: Math.min(Math.max(cursorIndex, 0), message.length),
    updatedAt: serverTimestamp(),
  }).catch(() => {});

  return true;
}

export function clearRealtimeSharedTaskNoteEditor(projectId: string, taskId: string, userId: string) {
  if (!realtimeDatabase || !projectId || !taskId || !userId) return false;

  disconnectRegistrations.delete(`shared:${projectId}:${taskId}:${userId}`);
  void remove(ref(realtimeDatabase, sharedTaskEditorPath(projectId, taskId, userId)));
  return true;
}

export function clearRealtimeSharedTaskNoteDraft(projectId: string, taskId: string) {
  if (!realtimeDatabase || !projectId || !taskId) return false;

  void remove(ref(realtimeDatabase, sharedTaskDraftPath(projectId, taskId)));
  return true;
}
