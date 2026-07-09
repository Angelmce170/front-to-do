import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import ProjectAlerts from "../projects/ProjectAlerts";
import ProjectAttachmentModal from "../projects/ProjectAttachmentModal";
import ProjectChat from "../projects/ProjectChat";
import { emptyProjectForm, emptyTaskForm, fileToAttachment, formatDate, fromDateInput, projectFromResponse } from "../projects/projectUtils";
import type { ChatScope, Project, ProjectAlert, ProjectAttachment, ProjectFormEvent, ProjectTask, UserMini } from "../projects/types";

type Props = {
  currentUser: UserMini | null;
};

export default function ProjectsPanel({ currentUser }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [projectForm, setProjectForm] = useState(emptyProjectForm);
  const [projectAttachment, setProjectAttachment] = useState<ProjectAttachment | null>(null);
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);
  const [friends, setFriends] = useState<UserMini[]>([]);
  const [friendQuery, setFriendQuery] = useState("");
  const [friendResults, setFriendResults] = useState<UserMini[]>([]);
  const [alerts, setAlerts] = useState<ProjectAlert[]>([]);
  const [projectView, setProjectView] = useState<"overview" | "tasks" | "schedule">("overview");
  const [taskForm, setTaskForm] = useState(emptyTaskForm);
  const [inviteEmails, setInviteEmails] = useState("");
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [chatOpen, setChatOpen] = useState(false);
  const [chatScope, setChatScope] = useState<ChatScope>("group");
  const [chatTo, setChatTo] = useState("");
  const [chatText, setChatText] = useState("");
  const [notice, setNotice] = useState("");
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const activityRef = useRef(0);

  const selectedProject = projects.find((project) => project._id === selectedId) || projects[0] || null;
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
  const sortedSchedule = [...(selectedProject?.tasks || [])].sort((a, b) => {
    const aTime = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
    const bTime = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
    return aTime - bTime;
  });

  function applyProject(nextProject: Project) {
    setProjects((current) => {
      const exists = current.some((project) => project._id === nextProject._id);
      return exists
        ? current.map((project) => (project._id === nextProject._id ? nextProject : project))
        : [nextProject, ...current];
    });
    setSelectedId(nextProject._id);
  }

  async function loadProjects() {
    const { data } = await api.get("/projects");
    const items = Array.isArray(data.items) ? (data.items as Project[]) : [];
    setProjects(items);
    setSelectedId((current) => current || items[0]?._id || "");
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

  useEffect(() => {
    void (async () => {
      const joinCode = new URLSearchParams(window.location.search).get("joinProject");
      if (joinCode) {
        try {
          const { data } = await api.post(`/projects/join/${joinCode}`);
          applyProject(projectFromResponse(data.project));
          window.history.replaceState({}, "", "/dashboard");
          setNotice("Te uniste al proyecto por enlace.");
        } catch {
          setNotice("No se pudo usar el enlace de invitación.");
        }
      }

      await Promise.all([loadProjects(), loadFriends(), loadAlerts()]);
    })();
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
    }, 5000);

    return () => window.clearInterval(timer);
  }, [selectedId]);

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
        memberIds: selectedFriends,
      });
      applyProject(projectFromResponse(data.project));
      setProjectForm(emptyProjectForm);
      setProjectAttachment(null);
      setSelectedFriends([]);
      setNotice("Proyecto creado.");
      await Promise.all([loadProjects(), loadAlerts()]);
    } catch (error) {
      setNotice((error as { response?: { data?: { message?: string } } }).response?.data?.message || "No se pudo crear el proyecto.");
    }
  }

  async function searchFriends(event: ProjectFormEvent) {
    event.preventDefault();
    if (friendQuery.trim().length < 2) return;

    const { data } = await api.get("/projects/friends/search", { params: { q: friendQuery } });
    setFriendResults(Array.isArray(data.items) ? data.items : []);
  }

  async function addFriend(user: UserMini) {
    await api.post("/projects/friends", { userId: user.id });
    setFriendQuery("");
    setFriendResults([]);
    await loadFriends();
    setNotice(`${user.name} se agregó a tus amigos.`);
  }

  async function acceptProject() {
    if (!selectedProject) return;

    const { data } = await api.post(`/projects/${selectedProject._id}/accept`);
    applyProject(projectFromResponse(data.project));
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

      <div className="projects-layout">
        <aside className="project-sidebar">
          <form className="project-card project-create" onSubmit={createProject}>
            <p className="eyebrow">NUEVO PROYECTO</p>
            <label className="field">
              <span>Título</span>
              <input
                value={projectForm.title}
                onChange={(event) => setProjectForm({ ...projectForm, title: event.target.value })}
                onFocus={() => pingActivity("proyecto", "preparando un proyecto")}
                placeholder="Nombre del proyecto"
              />
            </label>
            <label className="field">
              <span>Descripción</span>
              <textarea
                value={projectForm.description}
                onChange={(event) => setProjectForm({ ...projectForm, description: event.target.value })}
                rows={2}
                placeholder="Objetivo, entregables o contexto"
              />
            </label>
            <div className="segmented-control">
              <button
                className={projectForm.mode === "individual" ? "active" : ""}
                type="button"
                onClick={() => setProjectForm({ ...projectForm, mode: "individual" })}
              >
                Individual
              </button>
              <button
                className={projectForm.mode === "group" ? "active" : ""}
                type="button"
                onClick={() => setProjectForm({ ...projectForm, mode: "group" })}
              >
                Grupo
              </button>
            </div>
            {projectForm.mode === "group" && (
              <>
                <label className="field">
                  <span>Límite de participantes</span>
                  <input
                    type="number"
                    min={2}
                    max={50}
                    value={projectForm.participantLimit}
                    onChange={(event) =>
                      setProjectForm({ ...projectForm, participantLimit: Number(event.target.value) })
                    }
                  />
                </label>
                <label className="field">
                  <span>Invitar por correo</span>
                  <input
                    value={projectForm.inviteEmails}
                    onChange={(event) => setProjectForm({ ...projectForm, inviteEmails: event.target.value })}
                    placeholder="correo@ejemplo.com, otro@ejemplo.com"
                  />
                </label>
                <div className="friend-picker">
                  <span>Amigos</span>
                  {friends.map((friend) => (
                    <label key={friend.id} className="friend-check">
                      <input
                        type="checkbox"
                        checked={selectedFriends.includes(friend.id)}
                        onChange={(event) =>
                          setSelectedFriends((current) =>
                            event.target.checked
                              ? [...current, friend.id]
                              : current.filter((id) => id !== friend.id)
                          )
                        }
                      />
                      {friend.name}
                    </label>
                  ))}
                </div>
              </>
            )}
            <label className="field">
              <span>Archivo interno</span>
              <input type="file" onChange={(event) => void handleProjectFile(event.target.files?.[0])} />
            </label>
            {projectAttachment?.name && <span className="sync-badge">{projectAttachment.name}</span>}
            <button className="btn btn-primary">Crear proyecto</button>
          </form>

          <form className="project-card friend-search" onSubmit={searchFriends}>
            <p className="eyebrow">AMIGOS</p>
            <div className="search-row">
              <input
                value={friendQuery}
                onChange={(event) => setFriendQuery(event.target.value)}
                placeholder="Buscar por nombre o correo"
              />
              <button className="btn btn-compact">Buscar</button>
            </div>
            <div className="friend-results">
              {friendResults.map((user) => (
                <button key={user.id} type="button" onClick={() => void addFriend(user)}>
                  <span>{user.name}</span>
                  <small>{user.email}</small>
                </button>
              ))}
            </div>
          </form>

          <div className="project-list">
            {projects.map((project) => (
              <button
                key={project._id}
                className={selectedProject?._id === project._id ? "project-list-item active" : "project-list-item"}
                type="button"
                onClick={() => setSelectedId(project._id)}
              >
                <strong>{project.title}</strong>
                <span>{project.mode === "group" ? "Grupo" : "Individual"} · {project.myStatus || "miembro"}</span>
              </button>
            ))}
          </div>
        </aside>

        <div className="project-workspace">
          {!selectedProject ? (
            <div className="empty-state">
              <span className="empty-icon">+</span>
              <h3>Crea tu primer proyecto</h3>
              <p>Organiza tareas, archivos, chat y participantes en un solo lugar.</p>
            </div>
          ) : (
            <>
              <div className="project-detail-head">
                <div>
                  <p className="eyebrow">{selectedProject.mode === "group" ? "PROYECTO GRUPAL" : "PROYECTO INDIVIDUAL"}</p>
                  <h3>{selectedProject.title}</h3>
                  <p>{selectedProject.description || "Sin descripción"}</p>
                </div>
                {selectedProject.myStatus === "invited" && (
                  <button className="btn btn-primary" type="button" onClick={() => void acceptProject()}>
                    Aceptar invitación
                  </button>
                )}
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

              {selectedProject.presence.length > 0 && (
                <div className="presence-strip">
                  {selectedProject.presence.map((presence) => (
                    <span key={`${presence.user?.id}-${presence.area}`}>
                      {presence.user?.name} está {presence.action}
                    </span>
                  ))}
                </div>
              )}

              {selectedProject.mode === "group" && selectedProject.isLeader && (
                <div className="share-box">
                  <div>
                    <p className="eyebrow">INVITACIÓN</p>
                    <strong>Link y QR del proyecto</strong>
                    <small>{joinLink}</small>
                  </div>
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(joinLink)}`}
                    alt="QR de invitación"
                  />
                  <button className="btn btn-compact" type="button" onClick={() => void copyJoinLink()}>
                    Copiar link
                  </button>
                  <form onSubmit={inviteMore}>
                    <input
                      value={inviteEmails}
                      onChange={(event) => setInviteEmails(event.target.value)}
                      placeholder="Invitar más correos"
                    />
                    <button className="btn btn-compact">Invitar</button>
                  </form>
                </div>
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
                  <h4>Actividad reciente</h4>
                  {(selectedProject.activity || []).slice().reverse().map((activity) => (
                    <p key={activity._id}>
                      <strong>{activity.user?.name || "Usuario"}</strong> {activity.text}
                      <small>{formatDate(activity.createdAt)}</small>
                    </p>
                  ))}
                  {!selectedProject.activity.length && <p>No hay actividad todavía.</p>}
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
          onOpenChange={setChatOpen}
          onScopeChange={setChatScope}
          onToChange={setChatTo}
          onTextChange={setChatText}
          onSend={sendMessage}
          onActivity={pingActivity}
        />
      )}

      {attachmentOpen && selectedProject?.attachment?.dataUrl && (
        <ProjectAttachmentModal project={selectedProject} onClose={() => setAttachmentOpen(false)} />
      )}
    </section>
  );
}
