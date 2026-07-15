import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api, setAuth } from "../api";
import { registerWebPushSubscription, unregisterWebPushSubscription, webPushConfigMessage } from "../webPush";
import {
  cacheTasks,
  getAllTasksLocal,
  putTaskLocal,
  removeTaskLocal,
  queue,
  type OutboxOp,
} from "../offline/db";
import { syncNow } from "../offline/sync";
import NotificationMenu from "../notifications/NotificationMenu";
import ProjectsPanel from "./ProjectsPanel";

type Status = "Pendiente" | "En Progreso" | "Completada";
type Filter = "all" | "active" | "completed";
type Task = {
  _id: string;
  title: string;
  description?: string;
  status: Status;
  reminderAt?: string | null;
  clienteId?: string;
  createdAt?: string;
  deleted?: boolean;
  pending?: boolean;
};
type Changes = Partial<Pick<Task, "title" | "description" | "status">> & {
  reminderAt?: string | null;
};
type UserProfile = {
  id?: string;
  name: string;
  email: string;
  avatarColor?: string;
};

const STATUSES: Status[] = ["Pendiente", "En Progreso", "Completada"];
const FILTERS: [Filter, string][] = [
  ["all", "Todas"],
  ["active", "Activas"],
  ["completed", "Hechas"],
];
const avatarColors = ["#2a8b7b", "#2563eb", "#7c3aed", "#dc2626", "#ea580c", "#475569", "#111827"];
const avatarColorNames: Record<string, string> = {
  "#2a8b7b": "Verde",
  "#2563eb": "Azul",
  "#7c3aed": "Morado",
  "#dc2626": "Rojo",
  "#ea580c": "Naranja",
  "#475569": "Gris",
  "#111827": "Negro",
};
const defaultAvatarColor = avatarColors[0];
const emptyForm = { title: "", description: "", reminderAt: "" };
const emptyEdit = { id: null as string | null, title: "", description: "", reminderAt: "" };
const emptyProfile = { name: "", email: "", password: "", avatarColor: defaultAvatarColor };
const remindersChangedEvent = "todo-pwa-reminders-changed";

const isLocalId = (id: string) => !/^[a-f0-9]{24}$/i.test(id);
const isStatus = (value: unknown): value is Status =>
  typeof value === "string" && STATUSES.includes(value as Status);
const profileColor = (value: unknown) =>
  typeof value === "string" && avatarColors.includes(value) ? value : defaultAvatarColor;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const text = (value: unknown, fallback = "") =>
  value === undefined || value === null ? fallback : String(value);
const ids = (id: string) =>
  isLocalId(id) ? { clienteId: id, serverId: undefined } : { clienteId: undefined, serverId: id };
const enqueue = (op: unknown) => queue(op as OutboxOp);
const enqueueCreate = (clienteId: string, data: Task) =>
  enqueue({ id: "op-" + clienteId, op: "create", clienteId, data, ts: Date.now() });
const enqueueUpdate = (id: string, data: Changes) =>
  enqueue({ id: "upd-" + id, op: "update", ...ids(id), data, ts: Date.now() });
const enqueueDelete = (id: string) =>
  enqueue({ id: "del-" + id, op: "delete", ...ids(id), ts: Date.now() });
const enqueueProfile = (data: { name: string; email: string; avatarColor: string }) =>
  enqueue({ id: "profile-update", op: "profile", data, ts: Date.now() });
const notifyReminderWatcher = () => window.dispatchEvent(new Event(remindersChangedEvent));
const initialDashboardTab = () => {
  const params = new URLSearchParams(window.location.search);
  return params.has("project") || params.has("joinProject") ? "projects" : "tasks";
};

function normalizeTask(value: unknown): Task {
  const task = record(value);
  const reminderDate = task.reminderAt ? new Date(String(task.reminderAt)) : null;

  return {
    _id: String(task._id ?? task.id ?? crypto.randomUUID()),
    title: text(task.title, "(sin título)"),
    description: text(task.description),
    status: isStatus(task.status) ? task.status : "Pendiente",
    reminderAt: reminderDate && !Number.isNaN(reminderDate.getTime()) ? reminderDate.toISOString() : null,
    clienteId: task.clienteId ? String(task.clienteId) : undefined,
    createdAt: task.createdAt ? String(task.createdAt) : undefined,
    deleted: Boolean(task.deleted),
    pending: Boolean(task.pending),
  };
}

function toReminderInput(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
}

function fromReminderInput(value: string) {
  return value ? new Date(value).toISOString() : null;
}

function formatReminder(value?: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function readStoredProfile() {
  try {
    const saved = localStorage.getItem("user");
    return saved ? (JSON.parse(saved) as UserProfile) : null;
  } catch {
    return null;
  }
}

const currentNotificationPermission = (): NotificationPermission =>
  "Notification" in window ? Notification.permission : "denied";

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [edit, setEdit] = useState(emptyEdit);
  const [online, setOnline] = useState(navigator.onLine);
  const [profile, setProfile] = useState<UserProfile | null>(() => readStoredProfile());
  const [profileForm, setProfileForm] = useState(emptyProfile);
  const [profileOpen, setProfileOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(
    currentNotificationPermission()
  );
  const [notificationReady, setNotificationReady] = useState(currentNotificationPermission() === "granted");
  const [dashboardTab, setDashboardTab] = useState<"tasks" | "projects">(initialDashboardTab);

  const loadProfile = useCallback(async () => {
    const saved = readStoredProfile();
    if (saved) {
      const savedColor = profileColor(saved.avatarColor);
      setProfile({ ...saved, avatarColor: savedColor });
      setProfileForm({ name: saved.name, email: saved.email, password: "", avatarColor: savedColor });
    }

    try {
      const raw = record((await api.get("/auth/me")).data);
      const user = record(raw.user);
      const nextProfile = {
        id: text(user.id || user._id),
        name: text(user.name),
        email: text(user.email),
        avatarColor: profileColor(user.avatarColor),
      };

      setProfile(nextProfile);
      setProfileForm({
        name: nextProfile.name,
        email: nextProfile.email,
        password: "",
        avatarColor: nextProfile.avatarColor,
      });
      localStorage.setItem("user", JSON.stringify(nextProfile));
    } catch {
      // Si está offline, se usa el perfil guardado localmente.
    }
  }, []);

  const loadFromServer = useCallback(async () => {
    try {
      const raw = record((await api.get("/tasks")).data);
      const list = Array.isArray(raw.items) ? raw.items.map(normalizeTask) : [];
      setTasks(list);
      await cacheTasks(list);
      notifyReminderWatcher();
    } catch {
      // Si falla internet, se conserva la cache local.
    } finally {
      setLoading(false);
    }
  }, []);

  const registerDeviceForPush = useCallback(async (showMessage = true) => {
    if (currentNotificationPermission() !== "granted") {
      setNotificationReady(false);
      return false;
    }

    if (showMessage) setNotificationSaving(true);
    const pushReady = await registerWebPushSubscription();
    if (showMessage) setNotificationSaving(false);
    setNotificationReady(pushReady);

    if (showMessage) {
      setNotice(
        pushReady
          ? "Dispositivo registrado para recordatorios."
          : webPushConfigMessage()
      );
    }

    return pushReady;
  }, []);

  const registerDeviceForPushSilently = useCallback(async () => {
    if (currentNotificationPermission() !== "granted") {
      setNotificationReady(false);
      return false;
    }

    const pushReady = await registerWebPushSubscription();
    setNotificationReady(pushReady);
    return pushReady;
  }, []);

  useEffect(() => {
    setAuth(localStorage.getItem("token"));

    const handleOnline = async () => {
      setOnline(true);
      await syncNow();
      await loadFromServer();
      await loadProfile();
      if (currentNotificationPermission() === "granted") void registerDeviceForPushSilently();
    };
    const handleOffline = () => setOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    void (async () => {
      const local = await getAllTasksLocal();
      if (local.length) setTasks(local.map(normalizeTask));
      setLoading(false);
      await loadProfile();
      await loadFromServer();
      await syncNow();
      await loadProfile();
      await loadFromServer();
    })();

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [loadFromServer, loadProfile, registerDeviceForPushSilently]);

  useEffect(() => {
    const syncPermission = () => {
      const permission = currentNotificationPermission();
      setNotificationPermission(permission);
      if (permission !== "granted") setNotificationReady(false);
    };

    syncPermission();
    window.addEventListener("focus", syncPermission);
    document.addEventListener("visibilitychange", syncPermission);

    return () => {
      window.removeEventListener("focus", syncPermission);
      document.removeEventListener("visibilitychange", syncPermission);
    };
  }, []);

  useEffect(() => {
    if (notificationPermission !== "granted") return;

    const timer = window.setTimeout(() => {
      void registerDeviceForPushSilently();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [notificationPermission, registerDeviceForPushSilently]);

  async function requestNotifications(options: { silentWhenGranted?: boolean } = {}) {
    if (!("Notification" in window)) {
      setNotice("Este navegador no permite notificaciones web.");
      return false;
    }

    if (currentNotificationPermission() === "granted") {
      setNotificationPermission("granted");
      await (options.silentWhenGranted ? registerDeviceForPushSilently() : registerDeviceForPush());
      notifyReminderWatcher();
      return true;
    }

    if (currentNotificationPermission() === "denied") {
      setNotificationPermission("denied");
      setNotice("Las notificaciones están bloqueadas en Chrome para este sitio.");
      return false;
    }

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);

    if (permission === "granted") {
      await registerDeviceForPush();
      notifyReminderWatcher();
      return true;
    }

    setNotice("No se activaron las notificaciones.");
    return false;
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setProfileMessage("");

    const name = profileForm.name.trim();
    const email = profile?.email || profileForm.email.trim();
    const nextAvatarColor = profileColor(profileForm.avatarColor);
    if (!name) {
      setProfileMessage("El nombre es obligatorio.");
      return;
    }

    const localProfile = {
      id: profile?.id,
      name,
      email,
      avatarColor: nextAvatarColor,
    };
    const profilePayload = {
      name,
      email,
      avatarColor: nextAvatarColor,
    };
    const password = profileForm.password.trim();
    const updateLocalProfile = async (message: string) => {
      setProfile(localProfile);
      setProfileForm({
        name: localProfile.name,
        email: localProfile.email,
        password: "",
        avatarColor: localProfile.avatarColor,
      });
      setChangingPassword(false);
      localStorage.setItem("user", JSON.stringify(localProfile));
      await enqueueProfile(profilePayload);
      setProfileMessage(message);
    };

    setProfileSaving(true);
    try {
      if (!navigator.onLine) {
        await updateLocalProfile(
          changingPassword && password
            ? "Perfil guardado sin conexión. Cambia la contraseña cuando tengas internet."
            : "Perfil guardado sin conexión. Se sincronizará al volver internet."
        );
        return;
      }

      const payload = {
        ...profilePayload,
        ...(changingPassword && password ? { password } : {}),
      };
      const raw = record((await api.put("/auth/me", payload)).data);
      const user = record(raw.user);
      const nextProfile = {
        id: text(user.id || user._id),
        name: text(user.name),
        email: text(user.email),
        avatarColor: profileColor(text(user.avatarColor, nextAvatarColor)),
      };

      setProfile(nextProfile);
      setProfileForm({
        name: nextProfile.name,
        email: nextProfile.email,
        password: "",
        avatarColor: nextProfile.avatarColor,
      });
      setChangingPassword(false);
      localStorage.setItem("user", JSON.stringify(nextProfile));
      setProfileMessage("Perfil actualizado.");
    } catch (err: unknown) {
      const requestError = err as { response?: { data?: { message?: string } } };
      if (!requestError.response) {
        await updateLocalProfile(
          changingPassword && password
            ? "Perfil guardado localmente. Cambia la contraseña cuando tengas internet."
            : "Perfil guardado localmente. Se sincronizará al volver internet."
        );
        return;
      }

      setProfileMessage(requestError.response?.data?.message || "No se pudo actualizar el perfil.");
    } finally {
      setProfileSaving(false);
    }
  }

  async function addTask(event: FormEvent) {
    event.preventDefault();
    const title = form.title.trim();
    const description = form.description.trim();
    const reminderAt = fromReminderInput(form.reminderAt);
    if (!title) return;
    if (reminderAt) await requestNotifications({ silentWhenGranted: true });

    const clienteId = crypto.randomUUID();
    const localTask = normalizeTask({
      _id: clienteId,
      title,
      description,
      status: "Pendiente",
      reminderAt,
      pending: true,
    });

    setTasks((current) => [localTask, ...current]);
    await putTaskLocal(localTask);
    notifyReminderWatcher();
    setForm(emptyForm);

    if (!navigator.onLine) return enqueueCreate(clienteId, localTask);

    try {
      const { data } = await api.post("/tasks", { title, description, reminderAt });
      const created = normalizeTask(record(data).task ?? data);
      setTasks((current) => current.map((task) => (task._id === clienteId ? created : task)));
      await putTaskLocal(created);
      notifyReminderWatcher();
    } catch {
      setTasks((current) =>
        current.map((task) => (task._id === clienteId ? { ...task, pending: true } : task))
      );
      await putTaskLocal({ ...localTask, pending: true });
      notifyReminderWatcher();
      await enqueueCreate(clienteId, localTask);
    }
  }

  async function updateTask(taskId: string, changes: Changes) {
    const current = tasks.find((task) => task._id === taskId);
    if (!current) return;
    if (changes.reminderAt) await requestNotifications({ silentWhenGranted: true });

    const updated = { ...current, ...changes, pending: current.pending || !navigator.onLine };
    setTasks((list) => list.map((task) => (task._id === taskId ? updated : task)));
    await putTaskLocal(updated);
    notifyReminderWatcher();

    if (!navigator.onLine) return enqueueUpdate(taskId, changes);

    try {
      await api.put(`/tasks/${taskId}`, changes);
    } catch {
      const pendingTask = { ...updated, pending: true };
      setTasks((list) => list.map((task) => (task._id === taskId ? pendingTask : task)));
      await putTaskLocal(pendingTask);
      notifyReminderWatcher();
      await enqueueUpdate(taskId, changes);
    }
  }

  async function saveEdit(taskId: string) {
    const title = edit.title.trim();
    if (!title) return;

    await updateTask(taskId, {
      title,
      description: edit.description.trim(),
      reminderAt: fromReminderInput(edit.reminderAt),
    });
    setEdit(emptyEdit);
  }

  async function removeTask(taskId: string) {
    const backup = tasks;
    setTasks((list) => list.filter((task) => task._id !== taskId));
    await removeTaskLocal(taskId);
    notifyReminderWatcher();

    if (!navigator.onLine) return enqueueDelete(taskId);

    try {
      await api.delete(`/tasks/${taskId}`);
    } catch {
      setTasks(backup);
      await Promise.all(backup.map(putTaskLocal));
      notifyReminderWatcher();
      await enqueueDelete(taskId);
    }
  }

  function startEdit(task: Task) {
    setEdit({
      id: task._id,
      title: task.title,
      description: task.description ?? "",
      reminderAt: toReminderInput(task.reminderAt),
    });
  }

  async function logout() {
    await unregisterWebPushSubscription();
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setAuth(null);
    window.location.href = "/";
  }

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return tasks.filter((task) => {
      const matchesText =
        !query ||
        task.title.toLowerCase().includes(query) ||
        (task.description ?? "").toLowerCase().includes(query);
      const matchesFilter =
        filter === "all" ||
        (filter === "active" && task.status !== "Completada") ||
        (filter === "completed" && task.status === "Completada");
      return matchesText && matchesFilter;
    });
  }, [tasks, search, filter]);

  const stats = useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter((task) => task.status === "Completada").length;
    const inProgress = tasks.filter((task) => task.status === "En Progreso").length;
    const pending = tasks.filter((task) => task.status === "Pendiente").length;

    return { total, pending, inProgress, done };
  }, [tasks]);

  const profileName = profile?.name || profile?.email || "Usuario";
  const profileInitial = profileName.trim().charAt(0).toUpperCase() || "U";
  const profileAvatarColor = profileColor(profile?.avatarColor || profileForm.avatarColor);
  const notificationsActive = notificationPermission === "granted" && notificationReady;
  const notificationLabel =
    notificationsActive
      ? "Notificaciones activas"
      : notificationPermission === "denied"
        ? "Notificaciones bloqueadas"
        : notificationPermission === "granted"
          ? "Activa recordatorios"
          : "Notificaciones";
  const notificationButtonLabel =
    notificationSaving
      ? "Activando..."
      : notificationPermission === "denied"
        ? "Bloqueadas"
        : "Activar";

  return (
    <div className="dashboard-shell">
      <header className="dashboard-header">
        <div className="dashboard-brand">
          <span className="app-mark" aria-hidden="true">✓</span>
          <div>
            <p className="eyebrow">TO-DO PWA</p>
            <h1>Mis tareas</h1>
          </div>
        </div>
        <div className="header-actions">
          <div className="profile-menu">
            <button
              className="profile-trigger"
              type="button"
              onClick={() => setProfileOpen((open) => !open)}
              aria-expanded={profileOpen}
            >
              <span
                className="profile-avatar"
                style={{ backgroundColor: profileAvatarColor }}
                aria-hidden="true"
              >
                {profileInitial}
              </span>
              <span className="profile-name">{profileName}</span>
            </button>

            {profileOpen && (
              <form className="profile-dropdown" onSubmit={saveProfile}>
                <div className="profile-dropdown-head">
                  <span
                    className="profile-avatar large"
                    style={{ backgroundColor: profileColor(profileForm.avatarColor) }}
                    aria-hidden="true"
                  >
                    {profileInitial}
                  </span>
                  <div>
                    <p className="eyebrow">CUENTA</p>
                    <strong>Mi perfil</strong>
                  </div>
                </div>

                <label className="field">
                  <span>Nombre</span>
                  <input
                    value={profileForm.name}
                    onChange={(event) => setProfileForm({ ...profileForm, name: event.target.value })}
                    placeholder="Tu nombre"
                  />
                </label>
                <div className="profile-readonly">
                  <span>Correo</span>
                  <strong>{profile?.email || profileForm.email || "Sin correo"}</strong>
                </div>
                <div className="avatar-color-picker">
                  <span>Color del icono</span>
                  <div className="avatar-color-options" aria-label="Color del icono">
                    {avatarColors.map((color) => (
                      <button
                        key={color}
                        className={
                          profileColor(profileForm.avatarColor) === color
                            ? "color-swatch active"
                            : "color-swatch"
                        }
                        type="button"
                        style={{ backgroundColor: color }}
                        onClick={() => setProfileForm({ ...profileForm, avatarColor: color })}
                        aria-label={avatarColorNames[color]}
                        title={avatarColorNames[color]}
                      />
                    ))}
                  </div>
                </div>

                <button
                  className="change-password-button"
                  type="button"
                  onClick={() => setChangingPassword((show) => !show)}
                >
                  {changingPassword ? "Ocultar contraseña" : "Cambiar contraseña"}
                </button>

                {changingPassword && (
                  <label className="field">
                    <span>Nueva contraseña</span>
                    <input
                      type="password"
                      value={profileForm.password}
                      onChange={(event) => setProfileForm({ ...profileForm, password: event.target.value })}
                      placeholder="Nueva contraseña"
                      autoComplete="new-password"
                    />
                  </label>
                )}

                {profileMessage && <p className="inline-message">{profileMessage}</p>}

                <button className="btn btn-primary profile-save-button" disabled={profileSaving}>
                  {profileSaving ? "Guardando..." : "Guardar cambios"}
                </button>
              </form>
            )}
          </div>

          <NotificationMenu />

          <span className={online ? "connection online" : "connection offline"}>
            <span className="connection-dot" />
            {online ? "En línea" : "Sin conexión"}
          </span>
          <button className="btn btn-danger btn-compact" onClick={() => void logout()}>Salir</button>
        </div>
      </header>

      <main className="dashboard-main">
        <div className="workspace-switcher" aria-label="Secciones del dashboard">
          <button
            className={dashboardTab === "tasks" ? "active" : ""}
            type="button"
            onClick={() => setDashboardTab("tasks")}
          >
            Tareas
          </button>
          <button
            className={dashboardTab === "projects" ? "active" : ""}
            type="button"
            onClick={() => setDashboardTab("projects")}
          >
            Proyectos
          </button>
        </div>

        {dashboardTab === "tasks" ? (
          <>
        <section className="summary-strip" aria-label="Resumen de tareas">
          <div><strong>{stats.total}</strong><span>Total</span></div>
          <div><strong>{stats.pending}</strong><span>Pendientes</span></div>
          <div><strong>{stats.inProgress}</strong><span>En Progreso</span></div>
          <div><strong>{stats.done}</strong><span>Completadas</span></div>
          <div className="progress-summary">
            <span>Progreso</span>
            <strong>{stats.total ? Math.round((stats.done / stats.total) * 100) : 0}%</strong>
            <span className="progress-track">
              <span style={{ width: `${stats.total ? (stats.done / stats.total) * 100 : 0}%` }} />
            </span>
          </div>
        </section>

        <section className="task-creator">
          <div className="section-heading">
            <div>
              <p className="eyebrow">CAPTURA RÁPIDA</p>
              <h2>Nueva tarea</h2>
            </div>
            <div className="notification-tools">
              <div className="notification-actions">
                <span className={`permission-pill ${notificationPermission}`}>
                  {notificationLabel}
                </span>
                {!notificationsActive && (
                  <button
                    className="btn btn-compact"
                    type="button"
                    onClick={() => void requestNotifications()}
                    disabled={notificationSaving || notificationPermission === "denied"}
                  >
                    {notificationButtonLabel}
                  </button>
                )}
              </div>
              <p>Instala la PWA para recibir recordatorios con más estabilidad.</p>
            </div>
          </div>
          <form className="add-grid" onSubmit={addTask}>
            <label className="field">
              <span>Título</span>
              <input
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
                placeholder="¿Qué necesitas hacer?"
              />
            </label>
            <label className="field">
              <span>Descripción <small>Opcional</small></span>
              <textarea
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                placeholder="Agrega un poco más de contexto"
                rows={2}
              />
            </label>
            <label className="field">
              <span>Recordatorio <small>Opcional</small></span>
              <input
                type="datetime-local"
                value={form.reminderAt}
                onChange={(event) => setForm({ ...form, reminderAt: event.target.value })}
              />
            </label>
            <button className="btn btn-primary add-button">+ Agregar tarea</button>
          </form>
          {notice && <p className="inline-message">{notice}</p>}
        </section>

        <section className="tasks-section">
          <div className="tasks-heading">
            <div>
              <p className="eyebrow">TU LISTA</p>
              <h2>Tareas</h2>
            </div>
            <span className="result-count">{filtered.length} de {tasks.length}</span>
          </div>

          <div className="toolbar">
            <label className="search-box">
              <span aria-hidden="true">⌕</span>
              <input
                placeholder="Buscar tareas..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <div className="filters" aria-label="Filtrar tareas">
              {FILTERS.map(([value, label]) => (
                <button
                  key={value}
                  className={filter === value ? "chip active" : "chip"}
                  onClick={() => setFilter(value)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="empty-state"><span className="loader" /><p>Cargando tareas...</p></div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon" aria-hidden="true">✓</span>
              <h3>{search || filter !== "all" ? "No hay coincidencias" : "Tu lista está vacía"}</h3>
              <p>{search || filter !== "all" ? "Prueba con otra búsqueda o filtro." : "Agrega tu primera tarea para comenzar."}</p>
            </div>
          ) : (
            <ul className="task-list">
              {filtered.map((task) => {
                const isEditing = edit.id === task._id;
                return (
                  <li key={task._id} className={task.status === "Completada" ? "task-item done" : "task-item"}>
                    <span className={`status-line status-${task.status.toLowerCase().replace(" ", "-")}`} />
                    <select
                      value={task.status}
                      onChange={(event) => updateTask(task._id, { status: event.target.value as Status })}
                      className="status-select"
                      title="Estado"
                    >
                      {STATUSES.map((status) => <option key={status}>{status}</option>)}
                    </select>

                    <div className="task-content">
                      {isEditing ? (
                        <>
                          <input
                            className="edit-field"
                            value={edit.title}
                            onChange={(event) => setEdit({ ...edit, title: event.target.value })}
                            placeholder="Título"
                            autoFocus
                          />
                          <textarea
                            className="edit-field"
                            value={edit.description}
                            onChange={(event) => setEdit({ ...edit, description: event.target.value })}
                            placeholder="Descripción"
                            rows={2}
                          />
                          <input
                            className="edit-field"
                            type="datetime-local"
                            value={edit.reminderAt}
                            onChange={(event) => setEdit({ ...edit, reminderAt: event.target.value })}
                            title="Recordatorio"
                          />
                        </>
                      ) : (
                        <>
                          <span
                            className="task-title"
                            onDoubleClick={() => startEdit(task)}
                          >
                            {task.title}
                          </span>
                          {task.description && <p className="task-description">{task.description}</p>}
                          <div className="task-badges">
                            {task.reminderAt && (
                              <span className="reminder-badge" title="Recordatorio">
                                Recordar {formatReminder(task.reminderAt)}
                              </span>
                            )}
                            {(task.pending || isLocalId(task._id)) && (
                              <span className="sync-badge" title="Aún no sincronizada">Falta sincronizar</span>
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    <div className="task-actions">
                      {isEditing ? (
                        <button className="btn btn-primary btn-compact" onClick={() => saveEdit(task._id)}>Guardar</button>
                      ) : (
                        <button
                          className="icon-button"
                          title="Editar"
                          aria-label={`Editar ${task.title}`}
                          onClick={() => startEdit(task)}
                        >
                          ✎
                        </button>
                      )}
                      <button
                        className="icon-button delete"
                        title="Eliminar"
                        aria-label={`Eliminar ${task.title}`}
                        onClick={() => removeTask(task._id)}
                      >
                        ×
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
          </>
        ) : (
          <ProjectsPanel
            currentUser={
              profile
                ? {
                    id: profile.id || "",
                    name: profile.name,
                    email: profile.email,
                    avatarColor: profile.avatarColor,
                  }
                : null
            }
          />
        )}
      </main>
    </div>
  );
}
