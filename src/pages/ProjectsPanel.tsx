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

export default function ProjectsPanel({ currentUser }: Props) {
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
  const [notice, setNotice] = useState("");
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const activityRef = useRef(0);

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
  const sortedSchedule = [...(selectedProject?.tasks || [])].sort((a, b) => {
    const aTime = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
    const bTime = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
    return aTime - bTime;
  });

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
          applyProject(projectFromResponse(data.project), false);
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
                onClick={() => {
                  setSelectedId((current) => (current === project._id ? "" : project._id));
                  setChatOpen(false);
                }}
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
        </aside>

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
