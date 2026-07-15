import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent } from "react";
import { api } from "../api";
import ProjectAlerts from "../projects/ProjectAlerts";
import ProjectAttachmentModal from "../projects/ProjectAttachmentModal";
import ProjectChat from "../projects/ProjectChat";
import ProjectCreateForm from "../projects/ProjectCreateForm";
import ProjectInviteBox from "../projects/ProjectInviteBox";
import { emptyProjectForm, emptyTaskForm, fileToAttachment, formatDate, fromDateInput, projectFromResponse, toDateInput } from "../projects/projectUtils";
import {
  clearRealtimeProjectPresence,
  publishRealtimeProjectPresence,
  realtimePresenceReady,
  watchRealtimeProjectPresence,
} from "../projects/realtimePresence";
import {
  clearRealtimeTaskNoteDraft,
  publishRealtimeTaskNoteDraft,
  watchRealtimeProjectNoteDrafts,
} from "../projects/realtimeNotes";
import type { ChatScope, Project, ProjectAlert, ProjectAttachment, ProjectFormEvent, ProjectNoteDraft, ProjectPresence, ProjectTask, UserMini } from "../projects/types";

type Props = {
  currentUser: UserMini | null;
};

type ChatUnreadInfo = {
  count: number;
  senders: string[];
};

function chatKey(scope: ChatScope, userId = "") {
  return scope === "group" ? "group" : `direct:${userId}`;
}

function alertData(alert: ProjectAlert) {
  return (alert.data && typeof alert.data === "object" ? alert.data : {}) as Record<string, unknown>;
}

function alertTextData(alert: ProjectAlert, key: string) {
  const value = alertData(alert)[key];
  return typeof value === "string" ? value : "";
}

function alertProjectId(alert: ProjectAlert) {
  return alertTextData(alert, "projectId") || alert.project?._id || "";
}

function alertChatKey(alert: ProjectAlert) {
  const chat = alertTextData(alert, "chat");
  if (chat === "direct") {
    return chatKey("direct", alertTextData(alert, "chatUserId") || alertTextData(alert, "authorId"));
  }

  return chat === "group" ? "group" : "";
}

function alertSender(alert: ProjectAlert) {
  return alertTextData(alert, "authorName") || "Alguien";
}

function dateParts(value?: string) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return null;

  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}

function activityDayKey(value?: string) {
  const parts = dateParts(value);
  if (!parts) return "";

  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function activityMonthKey(value?: string) {
  const parts = dateParts(value);
  if (!parts) return "";

  return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
}

function activityDayLabel(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(new Date(year, month - 1, day));
}

function activityMonthLabel(key: string) {
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

function currentTimeMs() {
  return Date.now();
}

const projectViewLabels = {
  overview: "Actividad",
  tasks: "Tareas",
  schedule: "Cronograma",
} as const;

type ProjectView = keyof typeof projectViewLabels;
type ProjectTaskFilter = "all" | "active" | "completed";

const projectTaskFilters: [ProjectTaskFilter, string][] = [
  ["all", "Todas"],
  ["active", "Activas"],
  ["completed", "Hechas"],
];
const criticalOverdueMs = 5 * 24 * 60 * 60 * 1000;

const emptyRealtimeNoteDrafts: Record<string, ProjectNoteDraft[]> = {};

function clearBackendProjectPresence(projectId: string) {
  const token = localStorage.getItem("token");
  const baseUrl = String(api.defaults.baseURL || "").replace(/\/$/, "");
  if (!projectId || !token || !baseUrl) return;

  fetch(`${baseUrl}/projects/${projectId}/activity`, {
    method: "POST",
    keepalive: true,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ area: "presence:clear", action: "salió" }),
  }).catch(() => {});
}

export default function ProjectsPanel({ currentUser }: Props) {
  const [isProjectMobile, setIsProjectMobile] = useState(() => window.matchMedia("(max-width: 780px)").matches);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [projectForm, setProjectForm] = useState(emptyProjectForm);
  const [projectAttachment, setProjectAttachment] = useState<ProjectAttachment | null>(null);
  const [friends, setFriends] = useState<UserMini[]>([]);
  const [alerts, setAlerts] = useState<ProjectAlert[]>([]);
  const [realtimePresenceState, setRealtimePresenceState] = useState<{ projectId: string; items: ProjectPresence[] }>({
    projectId: "",
    items: [],
  });
  const [realtimeNoteDraftsState, setRealtimeNoteDraftsState] = useState<{
    projectId: string;
    items: Record<string, ProjectNoteDraft[]>;
  }>({
    projectId: "",
    items: {},
  });
  const [projectView, setProjectView] = useState<ProjectView>("overview");
  const [taskForm, setTaskForm] = useState(emptyTaskForm);
  const [editingTaskId, setEditingTaskId] = useState("");
  const [editTaskForm, setEditTaskForm] = useState(emptyTaskForm);
  const [inviteEmails, setInviteEmails] = useState("");
  const [inviteFriendIds, setInviteFriendIds] = useState<string[]>([]);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [projectTaskSearch, setProjectTaskSearch] = useState("");
  const [projectTaskFilter, setProjectTaskFilter] = useState<ProjectTaskFilter>("all");
  const [deadlineNow, setDeadlineNow] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatScope, setChatScope] = useState<ChatScope>("group");
  const [chatTo, setChatTo] = useState("");
  const [chatText, setChatText] = useState("");
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [activityDayFilter, setActivityDayFilter] = useState("");
  const [activityMonthFilter, setActivityMonthFilter] = useState("");
  const [activityUserFilter, setActivityUserFilter] = useState("");
  const [notice, setNotice] = useState("");
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const activityRef = useRef(0);
  const cursorPresenceRef = useRef(0);
  const lastCursorRef = useRef<{ x: number; y: number } | null>(null);
  const noteTypingRef = useRef<Record<string, number>>({});
  const noteDraftsRef = useRef<Record<string, string>>({});
  const selectedProjectIdRef = useRef("");
  const selectedProjectStatusRef = useRef("");
  const currentUserRef = useRef<UserMini | null>(null);
  const projectViewRef = useRef<ProjectView>("overview");
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const typingRef = useRef<Record<string, number>>({});

  const selectedProject = projects.find((project) => project._id === selectedId) || null;
  const selectedProjectId = selectedProject?._id || "";
  const selectedProjectStatus = selectedProject?.myStatus || "";
  const useRealtimePresence = realtimePresenceReady();
  const projectOwnerLabel = (project: Project) =>
    project.creator?.id === currentUser?.id ? "Propio" : project.myStatus === "invited" ? "Invitación" : "Compartido";
  const projectOwnerClass = (project: Project) =>
    project.creator?.id === currentUser?.id ? "own" : project.myStatus === "invited" ? "invited" : "shared";
  const activeMembers = useMemo(
    () => (selectedProject?.members || []).filter((member) => member.status === "active" && member.user),
    [selectedProject]
  );
  const otherMembers = activeMembers.filter((member) => member.user?.id !== currentUser?.id);
  const friendIds = useMemo(() => new Set(friends.map((friend) => friend.id)), [friends]);
  const joinLink = selectedProject
    ? `${window.location.origin}/dashboard?joinProject=${selectedProject.inviteCode}`
    : "";
  const filteredMessages = (selectedProject?.messages || []).filter((message) => {
    if (chatScope === "group") return message.scope === "group";
    if (!chatTo || message.scope !== "direct") return false;

    const authorId = message.author?.id;
    const toId = message.to?.id;
    return (authorId === currentUser?.id && toId === chatTo) || (authorId === chatTo && toId === currentUser?.id);
  });
  const unreadMessageAlerts = useMemo(
    () =>
      selectedProject
        ? alerts.filter(
            (alert) =>
              !alert.read &&
              alert.type === "message" &&
              Boolean(alertChatKey(alert)) &&
              alertProjectId(alert) === selectedProject._id
          )
        : [],
    [alerts, selectedProject]
  );
  const unreadByChannel = useMemo(() => {
    const unread: Record<string, ChatUnreadInfo> = {};

    for (const alert of unreadMessageAlerts) {
      const key = alertChatKey(alert);
      if (!key) continue;

      const sender = alertSender(alert);
      const current = unread[key] || { count: 0, senders: [] };
      current.count += 1;
      if (!current.senders.includes(sender)) current.senders.push(sender);
      unread[key] = current;
    }

    return unread;
  }, [unreadMessageAlerts]);
  const currentChatKey = chatKey(chatScope, chatTo);
  const activeUnreadAlertIds = useMemo(
    () =>
      chatOpen
        ? unreadMessageAlerts
            .filter((alert) => alertChatKey(alert) === currentChatKey)
            .map((alert) => alert._id)
        : [],
    [chatOpen, currentChatKey, unreadMessageAlerts]
  );
  const chatUnreadTotal = unreadMessageAlerts.length;
  const typingByChannel = useMemo(() => {
    const typing: Record<string, UserMini[]> = {};
    if (!selectedProject || !currentUser?.id) return typing;

    for (const presence of selectedProject.presence || []) {
      if (!presence.user) continue;

      let key = "";
      if (presence.area === "chat:group") {
        key = "group";
      } else if (presence.area === `chat:direct:${currentUser.id}`) {
        key = chatKey("direct", presence.user.id);
      }

      if (!key) continue;
      typing[key] = [...(typing[key] || []), presence.user];
    }

    return typing;
  }, [currentUser, selectedProject]);
  const backendVisiblePresence = (selectedProject?.presence || []).filter(
    (presence) => !presence.area.startsWith("chat:")
  );
  const realtimePresence = realtimePresenceState.projectId === selectedProjectId ? realtimePresenceState.items : [];
  const visiblePresence = useRealtimePresence ? realtimePresence : backendVisiblePresence;
  const currentViewArea = `view:${projectView}`;
  const currentViewPresence = visiblePresence.filter((presence) => presence.area === currentViewArea);
  const remoteCursors = currentViewPresence.filter(
    (presence) => typeof presence.cursorX === "number" && typeof presence.cursorY === "number"
  );
  const notePresenceByTask = useMemo(() => {
    const typing: Record<string, UserMini[]> = {};

    for (const presence of visiblePresence) {
      if (!presence.user || !presence.area.startsWith("note:")) continue;

      const taskId = presence.area.slice(5);
      typing[taskId] = [...(typing[taskId] || []), presence.user];
    }

    return typing;
  }, [visiblePresence]);
  const realtimeNoteDrafts = useMemo(
    () =>
      realtimeNoteDraftsState.projectId === selectedProjectId
        ? realtimeNoteDraftsState.items
        : emptyRealtimeNoteDrafts,
    [realtimeNoteDraftsState.items, realtimeNoteDraftsState.projectId, selectedProjectId]
  );
  const activityItems = useMemo(
    () => [...(selectedProject?.activity || [])].reverse(),
    [selectedProject]
  );
  const activityDayOptions = useMemo(
    () => [...new Set(activityItems.map((activity) => activityDayKey(activity.createdAt)).filter(Boolean))],
    [activityItems]
  );
  const activityMonthOptions = useMemo(
    () => [...new Set(activityItems.map((activity) => activityMonthKey(activity.createdAt)).filter(Boolean))],
    [activityItems]
  );
  const activityUsers = useMemo(() => {
    const users = new Map<string, UserMini>();

    for (const activity of activityItems) {
      if (activity.user?.id) users.set(activity.user.id, activity.user);
    }

    return [...users.values()];
  }, [activityItems]);
  const filteredActivity = useMemo(
    () =>
      activityItems.filter((activity) => {
        const matchesDay = !activityDayFilter || activityDayKey(activity.createdAt) === activityDayFilter;
        const matchesMonth = !activityMonthFilter || activityMonthKey(activity.createdAt) === activityMonthFilter;
        const matchesUser = !activityUserFilter || activity.user?.id === activityUserFilter;

        return matchesDay && matchesMonth && matchesUser;
      }),
    [activityDayFilter, activityItems, activityMonthFilter, activityUserFilter]
  );
  const visibleActivity = activityExpanded ? filteredActivity : activityItems.slice(0, 10);
  const sortedSchedule = [...(selectedProject?.tasks || [])].sort((a, b) => {
    const aTime = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
    const bTime = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
    return aTime - bTime;
  });
  const projectTaskStats = useMemo(() => {
    const tasks = selectedProject?.tasks || [];
    const total = tasks.length;
    const done = tasks.filter((task) => task.status === "Completada").length;
    const pending = total - done;
    const progress = total ? Math.round((done / total) * 100) : 0;

    return { total, pending, done, progress };
  }, [selectedProject?.tasks]);
  const filteredProjectTasks = useMemo(() => {
    const query = projectTaskSearch.trim().toLowerCase();

    return (selectedProject?.tasks || []).filter((task) => {
      const assigneeText = taskAssignees(task)
        .map((user) => `${user.name} ${user.email}`)
        .join(" ")
        .toLowerCase();
      const matchesText =
        !query ||
        task.title.toLowerCase().includes(query) ||
        (task.description || "").toLowerCase().includes(query) ||
        task.status.toLowerCase().includes(query) ||
        assigneeText.includes(query);
      const matchesFilter =
        projectTaskFilter === "all" ||
        (projectTaskFilter === "active" && task.status !== "Completada") ||
        (projectTaskFilter === "completed" && task.status === "Completada");

      return matchesText && matchesFilter;
    });
  }, [projectTaskFilter, projectTaskSearch, selectedProject?.tasks]);

  function taskAssignees(task: ProjectTask): UserMini[] {
    const users = task.assignees?.length ? task.assignees : task.assignedTo ? [task.assignedTo] : [];
    return users.filter((user): user is UserMini => Boolean(user?.id));
  }

  function projectTaskDeadlineClass(task: ProjectTask) {
    if (!deadlineNow || task.status === "Completada" || !task.dueAt) return "";

    const dueTime = new Date(task.dueAt).getTime();
    if (Number.isNaN(dueTime)) return "";

    const overdueMs = deadlineNow - dueTime;
    if (overdueMs <= 0) return "";

    return overdueMs > criticalOverdueMs ? "project-task-overdue-critical" : "project-task-overdue-warning";
  }

  function toggleTaskAssignee(userId: string, checked: boolean) {
    setTaskForm((current) => ({
      ...current,
      assigneeIds: checked
        ? [...new Set([...current.assigneeIds, userId])]
        : current.assigneeIds.filter((id) => id !== userId),
    }));
  }

  function toggleEditTaskAssignee(userId: string, checked: boolean) {
    setEditTaskForm((current) => ({
      ...current,
      assigneeIds: checked
        ? [...new Set([...current.assigneeIds, userId])]
        : current.assigneeIds.filter((id) => id !== userId),
    }));
  }

  function startEditingTask(task: ProjectTask) {
    setEditingTaskId(task._id);
    setEditTaskForm({
      title: task.title,
      description: task.description || "",
      assigneeIds: taskAssignees(task).map((user) => user.id),
      dueAt: toDateInput(task.dueAt),
    });
  }

  function cancelEditingTask() {
    setEditingTaskId("");
    setEditTaskForm(emptyTaskForm);
  }

  function renderLiveDraft(draft: ProjectNoteDraft) {
    const cursorIndex = Math.min(Math.max(draft.cursorIndex, 0), draft.message.length);
    const before = draft.message.slice(0, cursorIndex);
    const after = draft.message.slice(cursorIndex);

    return (
      <p className="live-note-text">
        {before || "\u200b"}
        <span
          className="live-note-caret"
          style={{ "--note-color": draft.user.avatarColor || "#2a8b7b" } as CSSProperties}
        >
          <b>{draft.user.name}</b>
        </span>
        {after}
      </p>
    );
  }

  function selectProject(projectId: string) {
    setSelectedId((current) => (current === projectId ? "" : projectId));
    setChatOpen(false);
    setActivityExpanded(false);
    setActivityDayFilter("");
    setActivityMonthFilter("");
    setActivityUserFilter("");
  }

  function projectNavigation() {
    return (
      <>
        <div className="project-sidebar-head">
          <div>
            <p className="eyebrow">MIS PROYECTOS</p>
            <h3>Lista</h3>
          </div>
          <button className="btn btn-primary btn-compact" type="button" onClick={() => setCreateOpen(true)}>
            + Nuevo
          </button>
        </div>

        <div className="project-list">
          {projects.map((project) => (
            <button
              key={project._id}
              className={[
                "project-list-item",
                projectOwnerClass(project),
                selectedProject?._id === project._id ? "active" : "",
              ].filter(Boolean).join(" ")}
              type="button"
              onClick={() => selectProject(project._id)}
            >
              <span className={`project-origin ${projectOwnerClass(project)}`}>
                {projectOwnerLabel(project)}
              </span>
              <strong>{project.title}</strong>
              <span>{project.mode === "group" ? "Grupo" : "Individual"} · {project.myStatus || "miembro"}</span>
            </button>
          ))}
          {!projects.length && (
            <div className="project-list-empty">
              <strong>Sin proyectos</strong>
              <span>Crea uno nuevo para empezar.</span>
            </div>
          )}
        </div>
      </>
    );
  }

  function applyProject(nextProject: Project, selectProject = true) {
    setProjects((current) => {
      const exists = current.some((project) => project._id === nextProject._id);
      return exists
        ? current.map((project) => (project._id === nextProject._id ? nextProject : project))
        : [nextProject, ...current];
    });
    if (selectProject) setSelectedId(nextProject._id);
  }

  async function loadProjects() {
    const { data } = await api.get("/projects");
    const items = Array.isArray(data.items) ? (data.items as Project[]) : [];
    setProjects(items);
    setSelectedId((current) => (items.some((project) => project._id === current) ? current : ""));
    return items;
  }

  async function loadFriends() {
    const { data } = await api.get("/projects/friends");
    setFriends(Array.isArray(data.items) ? data.items : []);
  }

  async function loadAlerts() {
    const { data } = await api.get("/projects/alerts");
    setAlerts(Array.isArray(data.items) ? data.items : []);
  }

  function pingActivity(area: string, action: string) {
    if (!selectedProject || selectedProject.myStatus !== "active") return;
    const now = currentTimeMs();
    if (now - activityRef.current < 3000) return;

    activityRef.current = now;
    api.post(`/projects/${selectedProject._id}/activity`, { area, action }).catch(() => {});
  }

  function publishViewPresence(cursor = lastCursorRef.current, syncBackend = false) {
    if (!selectedProject || selectedProject.myStatus !== "active") return;

    const area = `view:${projectView}`;
    const action = `viendo ${projectViewLabels[projectView]}`;
    const sentRealtime = Boolean(
      useRealtimePresence &&
      currentUser &&
      publishRealtimeProjectPresence({
        projectId: selectedProject._id,
        user: currentUser,
        area,
        action,
        cursor,
      })
    );

    if (!sentRealtime || syncBackend) {
      api.post(`/projects/${selectedProject._id}/activity`, {
        area,
        action,
        cursorX: cursor?.x,
        cursorY: cursor?.y,
      }).catch(() => {});
    }
  }

  function trackProjectCursor(event: PointerEvent<HTMLDivElement>) {
    if (!selectedProject || selectedProject.myStatus !== "active" || !workspaceRef.current) return;

    const rect = workspaceRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const cursor = {
      x: Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1),
      y: Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1),
    };
    lastCursorRef.current = cursor;

    const now = currentTimeMs();
    if (now - cursorPresenceRef.current < (useRealtimePresence ? 80 : 280)) return;

    cursorPresenceRef.current = now;
    publishViewPresence(cursor);
  }

  function pingChatTyping() {
    if (!selectedProject || selectedProject.myStatus !== "active") return;
    if (chatScope === "direct" && !chatTo) return;

    const area = chatScope === "group" ? "chat:group" : `chat:direct:${chatTo}`;
    const now = currentTimeMs();
    if (now - (typingRef.current[area] || 0) < 1500) return;

    typingRef.current[area] = now;
    api.post(`/projects/${selectedProject._id}/activity`, { area, action: "escribiendo" }).catch(() => {});
  }

  function clearChatTyping() {
    if (!selectedProject || selectedProject.myStatus !== "active") return;

    api.post(`/projects/${selectedProject._id}/activity`, { area: "chat:clear", action: "idle" }).catch(() => {});
  }

  useEffect(() => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const joinCode = params.get("joinProject");
      const projectParam = params.get("project");
      const chatParam = params.get("chat");
      const chatUserParam = params.get("chatUser");

      if (joinCode) {
        try {
          const { data } = await api.post(`/projects/join/${joinCode}`);
          applyProject(projectFromResponse(data.project), false);
          window.history.replaceState({}, "", "/dashboard");
          setNotice("Te uniste al proyecto por enlace.");
        } catch {
          setNotice("No se pudo usar el enlace de invitación.");
        }
      }

      const [items] = await Promise.all([loadProjects(), loadFriends(), loadAlerts()]);
      if (projectParam && items.some((project) => project._id === projectParam)) {
        setSelectedId(projectParam);
        if (chatParam === "group" || chatParam === "direct") {
          setChatScope(chatParam);
          setChatTo(chatParam === "direct" ? chatUserParam || "" : "");
          setChatOpen(true);
        }
        window.history.replaceState({}, "", "/dashboard");
      }
    })();
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 780px)");
    const updateMobile = () => setIsProjectMobile(query.matches);

    updateMobile();
    query.addEventListener("change", updateMobile);
    return () => query.removeEventListener("change", updateMobile);
  }, []);

  useEffect(() => {
    const updateNow = () => setDeadlineNow(Date.now());

    updateNow();
    const timer = window.setInterval(updateNow, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
    selectedProjectStatusRef.current = selectedProjectStatus;
    currentUserRef.current = currentUser;
    projectViewRef.current = projectView;
  }, [currentUser, projectView, selectedProjectId, selectedProjectStatus]);

  useEffect(() => {
    noteDraftsRef.current = noteDrafts;
  }, [noteDrafts]);

  useEffect(() => {
    if (!useRealtimePresence || !selectedProjectId || selectedProjectStatus !== "active" || !currentUser?.id) return;

    return watchRealtimeProjectPresence(selectedProjectId, currentUser.id, (items) => {
      setRealtimePresenceState({ projectId: selectedProjectId, items });
    });
  }, [currentUser?.id, selectedProjectId, selectedProjectStatus, useRealtimePresence]);

  useEffect(() => {
    if (!useRealtimePresence || !selectedProjectId || selectedProjectStatus !== "active" || !currentUser?.id) return;

    return watchRealtimeProjectNoteDrafts(selectedProjectId, currentUser.id, (items) => {
      setRealtimeNoteDraftsState({ projectId: selectedProjectId, items });
    });
  }, [currentUser?.id, selectedProjectId, selectedProjectStatus, useRealtimePresence]);

  useEffect(() => {
    if (!selectedId) return;

    const timer = window.setInterval(() => {
      void (async () => {
        const [{ data: projectData }, { data: alertData }] = await Promise.all([
          api.get(`/projects/${selectedId}`),
          api.get("/projects/alerts"),
        ]);
        const nextProject = projectFromResponse(projectData.project);

        setProjects((current) =>
          current.map((project) => (project._id === nextProject._id ? nextProject : project))
        );
        setAlerts(Array.isArray(alertData.items) ? alertData.items : []);
      })();
    }, 1200);

    return () => window.clearInterval(timer);
  }, [selectedId]);

  useEffect(() => {
    if (!selectedProjectId) return;

    return () => {
      clearBackendProjectPresence(selectedProjectId);
      if (currentUser?.id) clearRealtimeProjectPresence(selectedProjectId, currentUser.id);
      if (currentUser?.id) {
        Object.keys(noteDraftsRef.current).forEach((taskId) => {
          clearRealtimeTaskNoteDraft(selectedProjectId, taskId, currentUser.id);
        });
      }
    };
  }, [currentUser?.id, selectedProjectId]);

  useEffect(() => {
    const clearCurrentPresence = () => {
      const projectId = selectedProjectIdRef.current;
      clearBackendProjectPresence(projectId);
      if (currentUserRef.current?.id) clearRealtimeProjectPresence(projectId, currentUserRef.current.id);
    };
    const publishCurrentPresence = () => {
      const projectId = selectedProjectIdRef.current;
      if (!projectId || selectedProjectStatusRef.current !== "active") return;

      const view = projectViewRef.current;
      const cursor = lastCursorRef.current;
      const area = `view:${view}`;
      const action = `viendo ${projectViewLabels[view]}`;
      const sentRealtime = Boolean(
        currentUserRef.current &&
        publishRealtimeProjectPresence({
          projectId,
          user: currentUserRef.current,
          area,
          action,
          cursor,
        })
      );

      if (!sentRealtime) {
        api.post(`/projects/${projectId}/activity`, {
          area,
          action,
          cursorX: cursor?.x,
          cursorY: cursor?.y,
        }).catch(() => {});
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        clearCurrentPresence();
      } else {
        publishCurrentPresence();
      }
    };

    window.addEventListener("pagehide", clearCurrentPresence);
    window.addEventListener("beforeunload", clearCurrentPresence);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", clearCurrentPresence);
      window.removeEventListener("beforeunload", clearCurrentPresence);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearCurrentPresence();
    };
  }, []);

  useEffect(() => {
    if (!selectedProjectId || selectedProjectStatus !== "active") return;

    const publish = () => {
      const cursor = lastCursorRef.current;
      const area = `view:${projectView}`;
      const action = `viendo ${projectViewLabels[projectView]}`;
      const sentRealtime = Boolean(
        useRealtimePresence &&
        currentUser &&
        publishRealtimeProjectPresence({
          projectId: selectedProjectId,
          user: currentUser,
          area,
          action,
          cursor,
        })
      );

      if (!sentRealtime) {
        api.post(`/projects/${selectedProjectId}/activity`, {
          area,
          action,
          cursorX: cursor?.x,
          cursorY: cursor?.y,
        }).catch(() => {});
      }
    };

    publish();
    const timer = window.setInterval(publish, 4000);

    return () => window.clearInterval(timer);
  }, [currentUser, projectView, selectedProjectId, selectedProjectStatus, useRealtimePresence]);

  useEffect(() => {
    if (!activeUnreadAlertIds.length) return;

    const ids = activeUnreadAlertIds;
    void Promise.all(ids.map((id) => api.patch(`/projects/alerts/${id}/read`)))
      .then(() => {
        setAlerts((current) =>
          current.map((alert) => (ids.includes(alert._id) ? { ...alert, read: true } : alert))
        );
      })
      .catch(() => {});
  }, [activeUnreadAlertIds]);

  async function handleProjectFile(file?: File) {
    if (!file) {
      setProjectAttachment(null);
      return;
    }

    if (file.size > 2_500_000) {
      setNotice("El archivo debe pesar menos de 2.5 MB para guardarlo dentro de la app.");
      return;
    }

    setProjectAttachment(await fileToAttachment(file));
  }

  async function createProject(event: ProjectFormEvent) {
    event.preventDefault();
    if (!projectForm.title.trim()) return;

    try {
      const { data } = await api.post("/projects", {
        ...projectForm,
        attachment: projectAttachment,
      });
      applyProject(projectFromResponse(data.project));
      setProjectForm(emptyProjectForm);
      setProjectAttachment(null);
      setCreateOpen(false);
      setNotice("Proyecto creado.");
      await Promise.all([loadProjects(), loadAlerts()]);
    } catch (error) {
      setNotice((error as { response?: { data?: { message?: string } } }).response?.data?.message || "No se pudo crear el proyecto.");
    }
  }

  async function acceptProject() {
    if (!selectedProject) return;

    const { data } = await api.post(`/projects/${selectedProject._id}/accept`);
    applyProject(projectFromResponse(data.project), false);
    setSelectedId("");
    setChatOpen(false);
    await loadAlerts();
  }

  async function inviteMore(event: ProjectFormEvent) {
    event.preventDefault();
    if (!selectedProject) return;

    const { data } = await api.post(`/projects/${selectedProject._id}/invite-email`, { emails: inviteEmails });
    applyProject(projectFromResponse(data.project));
    setInviteEmails("");
    setNotice("Invitaciones enviadas.");
  }

  async function inviteSelectedFriends() {
    if (!selectedProject || !inviteFriendIds.length) return;

    const { data } = await api.post(`/projects/${selectedProject._id}/invite-friends`, {
      userIds: inviteFriendIds,
    });
    applyProject(projectFromResponse(data.project));
    setInviteFriendIds([]);
    setNotice("Amigos invitados al proyecto.");
  }

  async function addParticipantFriend(user: UserMini) {
    if (!user.id || friendIds.has(user.id) || user.id === currentUser?.id) return;

    const { data } = await api.post("/projects/friends", { userId: user.id });
    const friend = data.friend as UserMini | undefined;
    if (friend?.id) {
      setFriends((current) => current.some((item) => item.id === friend.id) ? current : [...current, friend]);
    } else {
      await loadFriends();
    }
    setNotice(`${user.name} ahora está en tus amigos.`);
  }

  async function createTask(event: ProjectFormEvent) {
    event.preventDefault();
    if (!selectedProject || !taskForm.title.trim() || !taskForm.assigneeIds.length) return;

    const { data } = await api.post(`/projects/${selectedProject._id}/tasks`, {
      title: taskForm.title,
      description: taskForm.description,
      assigneeIds: taskForm.assigneeIds,
      dueAt: fromDateInput(taskForm.dueAt),
    });
    applyProject(projectFromResponse(data.project));
    setTaskForm(emptyTaskForm);
  }

  async function updateTaskStatus(task: ProjectTask, status: ProjectTask["status"]) {
    if (!selectedProject) return;

    const { data } = await api.patch(`/projects/${selectedProject._id}/tasks/${task._id}`, { status });
    applyProject(projectFromResponse(data.project));
  }

  async function saveTaskEdit(event: ProjectFormEvent, task: ProjectTask) {
    event.preventDefault();
    if (!selectedProject || !editTaskForm.title.trim() || !editTaskForm.assigneeIds.length) return;

    const { data } = await api.patch(`/projects/${selectedProject._id}/tasks/${task._id}`, {
      title: editTaskForm.title,
      description: editTaskForm.description,
      assigneeIds: editTaskForm.assigneeIds,
      dueAt: fromDateInput(editTaskForm.dueAt),
    });
    applyProject(projectFromResponse(data.project));
    cancelEditingTask();
    setNotice("Tarea actualizada.");
  }

  async function deleteProjectTask(task: ProjectTask) {
    if (!selectedProject) return;
    if (!window.confirm(`¿Borrar "${task.title}"?`)) return;

    const { data } = await api.delete(`/projects/${selectedProject._id}/tasks/${task._id}`);
    applyProject(projectFromResponse(data.project));
    if (editingTaskId === task._id) cancelEditingTask();
    setNotice("Tarea eliminada.");
  }

  function pingTaskNoteTyping(task: ProjectTask) {
    if (!selectedProject || selectedProject.myStatus !== "active" || !currentUser) return;
    const now = currentTimeMs();
    if (now - (noteTypingRef.current[task._id] || 0) < 1200) return;

    noteTypingRef.current[task._id] = now;
    const area = `note:${task._id}`;
    const action = `escribiendo una nota en ${task.title}`;
    const sentRealtime = publishRealtimeProjectPresence({
      projectId: selectedProject._id,
      user: currentUser,
      area,
      action,
      cursor: null,
    });

    if (!sentRealtime) {
      api.post(`/projects/${selectedProject._id}/activity`, { area, action }).catch(() => {});
    }
  }

  function updateTaskNoteDraft(task: ProjectTask, message: string, cursorIndex: number) {
    setNoteDrafts((current) => ({ ...current, [task._id]: message }));
    if (!selectedProject || selectedProject.myStatus !== "active" || !currentUser) return;

    if (!message.trim()) {
      clearRealtimeTaskNoteDraft(selectedProject._id, task._id, currentUser.id);
      return;
    }

    const sentRealtime = publishRealtimeTaskNoteDraft({
      projectId: selectedProject._id,
      taskId: task._id,
      user: currentUser,
      message,
      cursorIndex,
    });

    if (!sentRealtime) pingTaskNoteTyping(task);
  }

  async function addTaskNote(event: ProjectFormEvent, task: ProjectTask) {
    event.preventDefault();
    if (!selectedProject || !currentUser?.id) return;

    const message = noteDrafts[task._id]?.trim();
    if (!message) return;

    const { data } = await api.post(`/projects/${selectedProject._id}/tasks/${task._id}/notes`, { message });
    applyProject(projectFromResponse(data.project));
    setNoteDrafts((current) => ({ ...current, [task._id]: "" }));
    clearRealtimeTaskNoteDraft(selectedProject._id, task._id, currentUser.id);
    publishViewPresence(lastCursorRef.current);
  }

  async function deleteTaskNote(task: ProjectTask, noteId: string) {
    if (!selectedProject) return;

    const { data } = await api.delete(`/projects/${selectedProject._id}/tasks/${task._id}/notes/${noteId}`);
    applyProject(projectFromResponse(data.project));
  }

  async function sendMessage(event: ProjectFormEvent) {
    event.preventDefault();
    if (!selectedProject || !chatText.trim()) return;

    const { data } = await api.post(`/projects/${selectedProject._id}/messages`, {
      scope: chatScope,
      to: chatScope === "direct" ? chatTo : undefined,
      text: chatText,
    });
    applyProject(projectFromResponse(data.project));
    setChatText("");
    clearChatTyping();
  }

  async function copyJoinLink() {
    if (!joinLink) return;

    await navigator.clipboard?.writeText(joinLink);
    setNotice("Link copiado.");
  }

  return (
    <section className="projects-panel">
      <div className="projects-topline">
        <div>
          <p className="eyebrow">COLABORACIÓN</p>
          <h2>Proyectos</h2>
        </div>
        <ProjectAlerts
          alerts={alerts}
          onRead={(alertId) => void api.patch(`/projects/alerts/${alertId}/read`).then(loadAlerts)}
        />
      </div>

      {notice && <p className="inline-message">{notice}</p>}

      {isProjectMobile && (
        <div className="mobile-project-nav">
          {projectNavigation()}
        </div>
      )}

      <div className="projects-layout">
        {!isProjectMobile && <aside className="project-sidebar">{projectNavigation()}</aside>}

        <div
          ref={workspaceRef}
          className="project-workspace"
          onPointerMove={trackProjectCursor}
        >
          {remoteCursors.length > 0 && (
            <div className="project-cursor-layer" aria-live="polite">
              {remoteCursors.map((presence) => (
                <span
                  key={`${presence.user?.id}-${presence.area}`}
                  className="project-remote-cursor"
                  style={{
                    left: `${(presence.cursorX || 0) * 100}%`,
                    top: `${(presence.cursorY || 0) * 100}%`,
                    "--cursor-color": presence.user?.avatarColor || "#2a8b7b",
                  } as CSSProperties}
                >
                  <i aria-hidden="true" />
                  <b>{presence.user?.name || "Usuario"}</b>
                </span>
              ))}
            </div>
          )}
          {!selectedProject ? (
            <div className="empty-state">
              <span className="empty-icon">+</span>
              <h3>{projects.length ? "Selecciona un proyecto" : "Crea tu primer proyecto"}</h3>
              <p>{projects.length ? "Abre un proyecto para ver sus tareas, archivos y chat." : "Organiza tareas, archivos, chat y participantes en un solo lugar."}</p>
            </div>
          ) : (
            <>
              <div className="project-detail-head">
                <div>
                  <p className="eyebrow">{selectedProject.mode === "group" ? "PROYECTO GRUPAL" : "PROYECTO INDIVIDUAL"}</p>
                  <h3>{selectedProject.title}</h3>
                  <p>{selectedProject.description || "Sin descripción"}</p>
                </div>
                <div className="project-detail-actions">
                  {selectedProject.myStatus === "invited" && (
                    <button className="btn btn-primary" type="button" onClick={() => void acceptProject()}>
                      Aceptar invitación
                    </button>
                  )}
                  <button
                    className="btn btn-compact"
                    type="button"
                    onClick={() => {
                      setSelectedId("");
                      setChatOpen(false);
                    }}
                  >
                    Cerrar
                  </button>
                </div>
              </div>

              <div className="project-meta-grid">
                <div>
                  <span>Líder</span>
                  <strong>{selectedProject.creator?.name || "Usuario"}</strong>
                </div>
                <div className="project-participants-cell">
                  <span>Participantes</span>
                  <strong>{selectedProject.members.length}/{selectedProject.participantLimit}</strong>
                  <div className="project-participant-list">
                    {selectedProject.members.map((member) => {
                      const user = member.user;
                      const isCurrentUser = user?.id === currentUser?.id;
                      const isFriend = Boolean(user?.id && friendIds.has(user.id));
                      const memberLabel =
                        member.role === "leader"
                          ? "Líder"
                          : member.status === "invited"
                            ? "Invitado"
                            : "Miembro";

                      return (
                        <div key={user?.id || `${memberLabel}-${member.status}`} className="project-participant-row">
                          <span
                            className="participant-avatar"
                            style={{ backgroundColor: user?.avatarColor || "#2a8b7b" }}
                            aria-hidden="true"
                          >
                            {user?.name?.trim().charAt(0).toUpperCase() || "U"}
                          </span>
                          <div>
                            <strong>{user?.name || "Usuario"}</strong>
                            <small>{isCurrentUser ? "Tú" : memberLabel}</small>
                          </div>
                          {user && !isCurrentUser && (
                            <button
                              className="participant-friend-action"
                              type="button"
                              disabled={isFriend}
                              onClick={() => void addParticipantFriend(user)}
                            >
                              {isFriend ? "Amigo" : "Agregar amigo"}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <span>Archivo</span>
                  {selectedProject.attachment?.dataUrl ? (
                    <button type="button" onClick={() => setAttachmentOpen(true)}>
                      Ver {selectedProject.attachment.name}
                    </button>
                  ) : (
                    <strong>Sin archivo</strong>
                  )}
                </div>
              </div>

              {currentViewPresence.length > 0 && (
                <div className="presence-strip">
                  {currentViewPresence.map((presence) => (
                    <span key={`${presence.user?.id}-${presence.area}`}>
                      {presence.user?.name} está {presence.action}
                    </span>
                  ))}
                </div>
              )}

              {selectedProject.mode === "group" && selectedProject.isLeader && (
                <ProjectInviteBox
                  project={selectedProject}
                  joinLink={joinLink}
                  inviteEmails={inviteEmails}
                  friends={friends}
                  selectedFriendIds={inviteFriendIds}
                  onInviteEmailsChange={setInviteEmails}
                  onToggleFriend={(friendId, checked) =>
                    setInviteFriendIds((current) =>
                      checked ? [...current, friendId] : current.filter((id) => id !== friendId)
                    )
                  }
                  onCopyLink={() => void copyJoinLink()}
                  onInviteByEmail={inviteMore}
                  onInviteFriends={() => void inviteSelectedFriends()}
                />
              )}

              <div className="project-tabs">
                {(["overview", "tasks", "schedule"] as const).map((tab) => (
                  <button
                    key={tab}
                    className={projectView === tab ? "active" : ""}
                    type="button"
                    onClick={() => setProjectView(tab)}
                  >
                    {tab === "overview" ? "Actividad" : tab === "tasks" ? "Tareas" : "Cronograma"}
                  </button>
                ))}
              </div>

              {projectView === "overview" && (
                <div className="project-card activity-card">
                  <div className="activity-card-head">
                    <div>
                      <h4>{activityExpanded ? "Actividad del proyecto" : "Actividad reciente"}</h4>
                      <span>{activityExpanded ? `${filteredActivity.length} movimientos` : "Últimas 10"}</span>
                    </div>
                    {activityExpanded && (
                      <button
                        className="btn btn-compact"
                        type="button"
                        onClick={() => {
                          setActivityDayFilter("");
                          setActivityMonthFilter("");
                          setActivityUserFilter("");
                        }}
                      >
                        Limpiar filtros
                      </button>
                    )}
                  </div>

                  {activityExpanded && (
                    <div className="activity-filters">
                      <label className="field">
                        <span>Día</span>
                        <select
                          value={activityDayFilter}
                          onChange={(event) => setActivityDayFilter(event.target.value)}
                        >
                          <option value="">Todos los días</option>
                          {activityDayOptions.map((day) => (
                            <option key={day} value={day}>
                              {activityDayLabel(day)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>Mes</span>
                        <select
                          value={activityMonthFilter}
                          onChange={(event) => setActivityMonthFilter(event.target.value)}
                        >
                          <option value="">Todos los meses</option>
                          {activityMonthOptions.map((month) => (
                            <option key={month} value={month}>
                              {activityMonthLabel(month)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>Usuario</span>
                        <select
                          value={activityUserFilter}
                          onChange={(event) => setActivityUserFilter(event.target.value)}
                        >
                          <option value="">Todos los usuarios</option>
                          {activityUsers.map((user) => (
                            <option key={user.id} value={user.id}>
                              {user.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}

                  <div className="activity-list">
                    {visibleActivity.map((activity) => (
                      <p key={activity._id}>
                        <strong>{activity.user?.name || "Usuario"}</strong> {activity.text}
                        <small>{formatDate(activity.createdAt)}</small>
                      </p>
                    ))}
                  </div>

                  {!activityItems.length && <p>No hay actividad todavía.</p>}
                  {activityItems.length > 10 && (
                    <button
                      className="btn activity-toggle-button"
                      type="button"
                      onClick={() => setActivityExpanded((expanded) => !expanded)}
                    >
                      {activityExpanded ? "Ver menos" : "Ver todo"}
                    </button>
                  )}
                  {activityExpanded && activityItems.length > 0 && !visibleActivity.length && (
                    <p className="inline-message">No hay actividad con esos filtros.</p>
                  )}
                </div>
              )}

              {projectView === "tasks" && (
                <div className="project-tasks">
                  <section className="summary-strip project-task-summary" aria-label="Resumen de tareas del proyecto">
                    <div><strong>{projectTaskStats.total}</strong><span>Total</span></div>
                    <div><strong>{projectTaskStats.pending}</strong><span>Pendientes</span></div>
                    <div><strong>{projectTaskStats.done}</strong><span>Completadas</span></div>
                    <div className="progress-summary">
                      <span>Progreso</span>
                      <strong>{projectTaskStats.progress}%</strong>
                      <span className="progress-track">
                        <span style={{ width: `${projectTaskStats.progress}%` }} />
                      </span>
                    </div>
                  </section>

                  {selectedProject.isLeader && selectedProject.myStatus === "active" && (
                    <form className="project-card task-assignment" onSubmit={createTask}>
                      <h4>Asignar tarea</h4>
                      <label className="field">
                        <span>Título</span>
                        <input
                          value={taskForm.title}
                          onChange={(event) => setTaskForm({ ...taskForm, title: event.target.value })}
                          onFocus={() => pingActivity("tareas", "creando una tarea")}
                        />
                      </label>
                      <label className="field">
                        <span>Descripción</span>
                        <textarea
                          value={taskForm.description}
                          onChange={(event) => setTaskForm({ ...taskForm, description: event.target.value })}
                          rows={2}
                        />
                      </label>
                      <div className="assignment-row">
                        <div className="field">
                          <span>Responsables</span>
                          <div className="assignee-picker">
                            {activeMembers.map((member) => {
                              const user = member.user;
                              if (!user) return null;

                              return (
                                <label key={user.id} className="assignee-option">
                                  <input
                                    type="checkbox"
                                    checked={taskForm.assigneeIds.includes(user.id)}
                                    onChange={(event) => toggleTaskAssignee(user.id, event.target.checked)}
                                  />
                                  <span
                                    className="participant-avatar"
                                    style={{ backgroundColor: user.avatarColor || "#2a8b7b" }}
                                    aria-hidden="true"
                                  >
                                    {user.name.trim().charAt(0).toUpperCase() || "U"}
                                  </span>
                                  <span>
                                    <strong>{user.name}</strong>
                                    <small>{user.email}</small>
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                        <label className="field">
                          <span>Fecha</span>
                          <input
                            type="datetime-local"
                            value={taskForm.dueAt}
                            onChange={(event) => setTaskForm({ ...taskForm, dueAt: event.target.value })}
                          />
                        </label>
                      </div>
                      <button className="btn btn-primary">Asignar</button>
                    </form>
                  )}

                  <section className="tasks-section project-task-browser">
                    <div className="tasks-heading">
                      <div>
                        <p className="eyebrow">TU LISTA</p>
                        <h2>Tareas</h2>
                      </div>
                      <span className="result-count">{filteredProjectTasks.length} de {selectedProject.tasks.length}</span>
                    </div>

                    <div className="toolbar">
                      <label className="search-box">
                        <span aria-hidden="true">⌕</span>
                        <input
                          placeholder="Buscar tareas..."
                          value={projectTaskSearch}
                          onChange={(event) => setProjectTaskSearch(event.target.value)}
                        />
                      </label>
                      <div className="filters" aria-label="Filtrar tareas del proyecto">
                        {projectTaskFilters.map(([value, label]) => (
                          <button
                            key={value}
                            className={projectTaskFilter === value ? "chip active" : "chip"}
                            onClick={() => setProjectTaskFilter(value)}
                            type="button"
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </section>

                  <div className="project-task-list">
                    {filteredProjectTasks.map((task) => {
                      const assignees = taskAssignees(task);
                      const canChangeStatus = assignees.some((user) => user?.id === currentUser?.id);
                      const canUseNotes = Boolean(task.canWriteNotes || selectedProject.isLeader || canChangeStatus);
                      const taskNotePresence = notePresenceByTask[task._id] || [];
                      const liveNoteDrafts = realtimeNoteDrafts[task._id] || [];
                      const isEditingTask = selectedProject.isLeader && editingTaskId === task._id;
                      return (
                        <article key={task._id} className={`project-card project-task-item ${projectTaskDeadlineClass(task)}`}>
                          {isEditingTask ? (
                            <form className="task-edit-form" onSubmit={(event) => void saveTaskEdit(event, task)}>
                              <div className="task-edit-head">
                                <div>
                                  <p className="eyebrow">EDITAR TAREA</p>
                                  <h4>{task.title}</h4>
                                </div>
                                <button
                                  className="btn btn-compact btn-danger"
                                  type="button"
                                  onClick={() => void deleteProjectTask(task)}
                                >
                                  Borrar
                                </button>
                              </div>
                              <label className="field">
                                <span>Título</span>
                                <input
                                  value={editTaskForm.title}
                                  onChange={(event) => setEditTaskForm({ ...editTaskForm, title: event.target.value })}
                                />
                              </label>
                              <label className="field">
                                <span>Descripción</span>
                                <textarea
                                  value={editTaskForm.description}
                                  onChange={(event) => setEditTaskForm({ ...editTaskForm, description: event.target.value })}
                                  rows={2}
                                />
                              </label>
                              <div className="assignment-row">
                                <div className="field">
                                  <span>Responsables</span>
                                  <div className="assignee-picker">
                                    {activeMembers.map((member) => {
                                      const user = member.user;
                                      if (!user) return null;

                                      return (
                                        <label key={user.id} className="assignee-option">
                                          <input
                                            type="checkbox"
                                            checked={editTaskForm.assigneeIds.includes(user.id)}
                                            onChange={(event) => toggleEditTaskAssignee(user.id, event.target.checked)}
                                          />
                                          <span
                                            className="participant-avatar"
                                            style={{ backgroundColor: user.avatarColor || "#2a8b7b" }}
                                            aria-hidden="true"
                                          >
                                            {user.name.trim().charAt(0).toUpperCase() || "U"}
                                          </span>
                                          <span>
                                            <strong>{user.name}</strong>
                                            <small>{user.email}</small>
                                          </span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                </div>
                                <label className="field">
                                  <span>Fecha</span>
                                  <input
                                    type="datetime-local"
                                    value={editTaskForm.dueAt}
                                    onChange={(event) => setEditTaskForm({ ...editTaskForm, dueAt: event.target.value })}
                                  />
                                </label>
                              </div>
                              <div className="task-edit-actions">
                                <button className="btn btn-primary" type="submit">
                                  Guardar cambios
                                </button>
                                <button className="btn btn-compact" type="button" onClick={cancelEditingTask}>
                                  Cancelar
                                </button>
                              </div>
                            </form>
                          ) : (
                            <>
                          <div className="task-row-head">
                            <div>
                              <strong>{task.title}</strong>
                              <p>{task.description || "Sin descripción"}</p>
                            </div>
                            <div className="project-task-actions">
                              <span className={`task-status ${task.status.toLowerCase().replace(/\s/g, "-")}`}>
                                {task.status}
                              </span>
                              {selectedProject.isLeader && selectedProject.myStatus === "active" && (
                                <div className="task-actions">
                                  <button className="btn btn-compact" type="button" onClick={() => startEditingTask(task)}>
                                    Editar
                                  </button>
                                  <button
                                    className="btn btn-compact btn-danger"
                                    type="button"
                                    onClick={() => void deleteProjectTask(task)}
                                  >
                                    Borrar
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="task-meta-line">
                            <span>Responsables: {assignees.length ? assignees.map((user) => `${user.name} (${user.email})`).join(", ") : "Sin asignar"}</span>
                            <span>{formatDate(task.dueAt)}</span>
                          </div>
                          {canChangeStatus && (
                            <div className="task-status-actions">
                              {(["Pendiente", "En Progreso", "Completada"] as const).map((status) => (
                                <button
                                  key={status}
                                  className={task.status === status ? "chip active" : "chip"}
                                  type="button"
                                  onClick={() => void updateTaskStatus(task, status)}
                                >
                                  {status}
                                </button>
                              ))}
                            </div>
                          )}
                          {canUseNotes && (
                            <div className="task-notes-box">
                              <div className="task-notes-head">
                                <strong>Notas</strong>
                                <span>{(task.notes || []).length} guardadas</span>
                              </div>

                              <div className="task-notes-list">
                                {liveNoteDrafts.map((draft) => (
                                  <article key={`draft-${draft.user.id}`} className="task-note-item live-note-item">
                                    <span
                                      className="participant-avatar"
                                      style={{ backgroundColor: draft.user.avatarColor || "#2a8b7b" }}
                                      aria-hidden="true"
                                    >
                                      {draft.user.name?.trim().charAt(0).toUpperCase() || "U"}
                                    </span>
                                    <div>
                                      <div className="task-note-meta">
                                        <strong>{draft.user.name}</strong>
                                        <small>escribiendo ahora</small>
                                      </div>
                                      {renderLiveDraft(draft)}
                                    </div>
                                  </article>
                                ))}

                                {(task.notes || []).map((note) => {
                                  const canDeleteNote = selectedProject.isLeader || note.author?.id === currentUser?.id;

                                  return (
                                    <article key={note._id} className="task-note-item">
                                      <span
                                        className="participant-avatar"
                                        style={{ backgroundColor: note.author?.avatarColor || "#2a8b7b" }}
                                        aria-hidden="true"
                                      >
                                        {note.author?.name?.trim().charAt(0).toUpperCase() || "U"}
                                      </span>
                                      <div>
                                        <div className="task-note-meta">
                                          <strong>{note.author?.name || "Usuario"}</strong>
                                          <small>{formatDate(note.createdAt)}</small>
                                        </div>
                                        <p>{note.message}</p>
                                      </div>
                                      {canDeleteNote && (
                                        <button
                                          className="note-delete-button"
                                          type="button"
                                          onClick={() => void deleteTaskNote(task, note._id)}
                                        >
                                          Borrar
                                        </button>
                                      )}
                                    </article>
                                  );
                                })}
                                {!task.notes?.length && <p className="task-note-empty">Sin notas todavía.</p>}
                              </div>

                              {taskNotePresence.length > 0 && !liveNoteDrafts.length && (
                                <div className="note-typing-strip">
                                  {taskNotePresence.map((user) => (
                                    <span key={user.id} style={{ "--note-color": user.avatarColor || "#2a8b7b" } as CSSProperties}>
                                      {user.name} está escribiendo
                                    </span>
                                  ))}
                                </div>
                              )}

                              {selectedProject.myStatus === "active" && (
                                <form className="task-note-form" onSubmit={(event) => void addTaskNote(event, task)}>
                                  <textarea
                                    value={noteDrafts[task._id] || ""}
                                    onChange={(event) => {
                                      updateTaskNoteDraft(task, event.currentTarget.value, event.currentTarget.selectionStart);
                                    }}
                                    onSelect={(event) => {
                                      const value = event.currentTarget.value;
                                      if (value.trim()) updateTaskNoteDraft(task, value, event.currentTarget.selectionStart);
                                    }}
                                    onFocus={() => pingTaskNoteTyping(task)}
                                    placeholder="Escribe una nota para esta tarea"
                                    rows={2}
                                  />
                                  <button className="btn btn-compact">Guardar nota</button>
                                </form>
                              )}
                            </div>
                          )}
                            </>
                          )}
                        </article>
                      );
                    })}
                    {!selectedProject.tasks.length && <p className="inline-message">Todavía no hay tareas en este proyecto.</p>}
                    {selectedProject.tasks.length > 0 && !filteredProjectTasks.length && (
                      <p className="inline-message">No hay tareas con esos filtros.</p>
                    )}
                  </div>
                </div>
              )}

              {projectView === "schedule" && (
                <div className="project-card schedule-card">
                  <h4>Cronograma automático</h4>
                  {sortedSchedule.map((task) => (
                    <div key={task._id} className="schedule-item">
                      <span>{formatDate(task.dueAt)}</span>
                      <strong>{task.title}</strong>
                      <small>{taskAssignees(task).map((user) => user.name).join(", ") || "Sin asignar"} · {task.status}</small>
                    </div>
                  ))}
                  {!sortedSchedule.length && <p>No hay fechas para ordenar.</p>}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {selectedProject && selectedProject.myStatus === "active" && (
        <ProjectChat
          project={selectedProject}
          currentUser={currentUser}
          otherMembers={otherMembers}
          messages={filteredMessages}
          open={chatOpen}
          scope={chatScope}
          to={chatTo}
          text={chatText}
          unreadTotal={chatUnreadTotal}
          unreadByChannel={unreadByChannel}
          typingByChannel={typingByChannel}
          onOpenChange={setChatOpen}
          onScopeChange={setChatScope}
          onToChange={setChatTo}
          onTextChange={setChatText}
          onSend={sendMessage}
          onTyping={pingChatTyping}
          onStopTyping={clearChatTyping}
        />
      )}

      {attachmentOpen && selectedProject?.attachment?.dataUrl && (
        <ProjectAttachmentModal project={selectedProject} onClose={() => setAttachmentOpen(false)} />
      )}

      {createOpen && (
        <div className="project-modal" role="dialog" aria-modal="true">
          <div className="project-modal-content project-create-dialog">
            <ProjectCreateForm
              form={projectForm}
              attachment={projectAttachment}
              onFormChange={setProjectForm}
              onFileChange={(file) => void handleProjectFile(file)}
              onSubmit={createProject}
              onCancel={() => setCreateOpen(false)}
              onActivity={pingActivity}
            />
          </div>
        </div>
      )}
    </section>
  );
}
