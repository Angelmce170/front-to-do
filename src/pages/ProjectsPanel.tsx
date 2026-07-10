import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import ProjectAlerts from "../projects/ProjectAlerts";
import ProjectAttachmentModal from "../projects/ProjectAttachmentModal";
import ProjectChat from "../projects/ProjectChat";
import ProjectCreateForm from "../projects/ProjectCreateForm";
import ProjectInviteBox from "../projects/ProjectInviteBox";
import { emptyProjectForm, emptyTaskForm, fileToAttachment, formatDate, fromDateInput, projectFromResponse } from "../projects/projectUtils";
import type { ChatScope, Project, ProjectAlert, ProjectAttachment, ProjectFormEvent, ProjectTask, UserMini } from "../projects/types";

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

export default function ProjectsPanel({ currentUser }: Props) {
  const [isProjectMobile, setIsProjectMobile] = useState(() => window.matchMedia("(max-width: 780px)").matches);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [projectForm, setProjectForm] = useState(emptyProjectForm);
  const [projectAttachment, setProjectAttachment] = useState<ProjectAttachment | null>(null);
  const [friends, setFriends] = useState<UserMini[]>([]);
  const [alerts, setAlerts] = useState<ProjectAlert[]>([]);
  const [projectView, setProjectView] = useState<"overview" | "tasks" | "schedule">("overview");
  const [taskForm, setTaskForm] = useState(emptyTaskForm);
  const [inviteEmails, setInviteEmails] = useState("");
  const [inviteFriendIds, setInviteFriendIds] = useState<string[]>([]);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
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
  const typingRef = useRef<Record<string, number>>({});

  const selectedProject = projects.find((project) => project._id === selectedId) || null;
  const projectOwnerLabel = (project: Project) =>
    project.creator?.id === currentUser?.id ? "Propio" : project.myStatus === "invited" ? "Invitación" : "Compartido";
  const projectOwnerClass = (project: Project) =>
    project.creator?.id === currentUser?.id ? "own" : project.myStatus === "invited" ? "invited" : "shared";
  const activeMembers = useMemo(
    () => (selectedProject?.members || []).filter((member) => member.status === "active" && member.user),
    [selectedProject]
  );
  const otherMembers = activeMembers.filter((member) => member.user?.id !== currentUser?.id);
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
  const visiblePresence = (selectedProject?.presence || []).filter(
    (presence) => !presence.area.startsWith("chat:")
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
    const now = Date.now();
    if (now - activityRef.current < 3000) return;

    activityRef.current = now;
    api.post(`/projects/${selectedProject._id}/activity`, { area, action }).catch(() => {});
  }

  function pingChatTyping() {
    if (!selectedProject || selectedProject.myStatus !== "active") return;
    if (chatScope === "direct" && !chatTo) return;

    const area = chatScope === "group" ? "chat:group" : `chat:direct:${chatTo}`;
    const now = Date.now();
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
    }, chatOpen ? 2500 : 5000);

    return () => window.clearInterval(timer);
  }, [chatOpen, selectedId]);

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

  async function createTask(event: ProjectFormEvent) {
    event.preventDefault();
    if (!selectedProject || !taskForm.title.trim()) return;

    const { data } = await api.post(`/projects/${selectedProject._id}/tasks`, {
      title: taskForm.title,
      description: taskForm.description,
      assignedTo: taskForm.assignedTo,
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

  async function addComment(event: ProjectFormEvent, task: ProjectTask) {
    event.preventDefault();
    if (!selectedProject) return;

    const message = commentDrafts[task._id]?.trim();
    if (!message) return;

    const { data } = await api.post(`/projects/${selectedProject._id}/tasks/${task._id}/comments`, { message });
    applyProject(projectFromResponse(data.project));
    setCommentDrafts((current) => ({ ...current, [task._id]: "" }));
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

        <div className="project-workspace">
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
                <div>
                  <span>Participantes</span>
                  <strong>{selectedProject.members.length}/{selectedProject.participantLimit}</strong>
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

              {visiblePresence.length > 0 && (
                <div className="presence-strip">
                  {visiblePresence.map((presence) => (
                    <span key={`${presence.user?.id}-${presence.area}`}>
                      {presence.user?.name} está {presence.action}
                    </span>
                  ))}
                </div>
              )}

              {selectedProject.mode === "group" && selectedProject.myStatus === "active" && (
                <ProjectInviteBox
                  project={selectedProject}
                  joinLink={joinLink}
                  inviteEmails={inviteEmails}
                  friends={friends}
                  selectedFriendIds={inviteFriendIds}
                  canManageInvites={selectedProject.isLeader}
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
                        <label className="field">
                          <span>Asignar a</span>
                          <select
                            value={taskForm.assignedTo}
                            onChange={(event) => setTaskForm({ ...taskForm, assignedTo: event.target.value })}
                          >
                            <option value="">Selecciona usuario</option>
                            {activeMembers.map((member) => (
                              <option key={member.user?.id} value={member.user?.id}>
                                {member.user?.name}
                              </option>
                            ))}
                          </select>
                        </label>
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

                  <div className="project-task-list">
                    {selectedProject.tasks.map((task) => {
                      const canChange = selectedProject.isLeader || task.assignedTo?.id === currentUser?.id;
                      return (
                        <article key={task._id} className="project-card project-task-item">
                          <div className="task-row-head">
                            <div>
                              <strong>{task.title}</strong>
                              <p>{task.description || "Sin descripción"}</p>
                            </div>
                            <span className={`task-status ${task.status.toLowerCase().replace(/\s/g, "-")}`}>
                              {task.status}
                            </span>
                          </div>
                          <div className="task-meta-line">
                            <span>Asignado a {task.assignedTo?.name || "Sin asignar"}</span>
                            <span>{formatDate(task.dueAt)}</span>
                          </div>
                          {canChange && (
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
                          <div className="comments-box">
                            {(task.comments || []).map((comment) => (
                              <p key={comment._id}>
                                <strong>{comment.author?.name || "Usuario"}:</strong> {comment.message}
                              </p>
                            ))}
                            {selectedProject.myStatus === "active" && (
                              <form onSubmit={(event) => void addComment(event, task)}>
                                <input
                                  value={commentDrafts[task._id] || ""}
                                  onChange={(event) =>
                                    setCommentDrafts((current) => ({ ...current, [task._id]: event.target.value }))
                                  }
                                  onFocus={() => pingActivity("comentarios", `comentando en ${task.title}`)}
                                  placeholder="Escribe un comentario"
                                />
                                <button className="btn btn-compact">Enviar</button>
                              </form>
                            )}
                          </div>
                        </article>
                      );
                    })}
                    {!selectedProject.tasks.length && <p className="inline-message">Todavía no hay tareas en este proyecto.</p>}
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
                      <small>{task.assignedTo?.name || "Sin asignar"} · {task.status}</small>
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
