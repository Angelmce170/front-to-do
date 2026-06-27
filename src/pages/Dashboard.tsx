import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api, setAuth } from "../api";
import {
  cacheTasks,
  getAllTasksLocal,
  putTaskLocal,
  removeTaskLocal,
  queue,
  type OutboxOp,
} from "../offline/db";
import { syncNow } from "../offline/sync";

type Status = "Pendiente" | "En Progreso" | "Completada";
type Filter = "all" | "active" | "completed";
type Task = {
  _id: string;
  title: string;
  description?: string;
  status: Status;
  clienteId?: string;
  createdAt?: string;
  deleted?: boolean;
  pending?: boolean;
};
type Changes = Partial<Pick<Task, "title" | "description" | "status">>;

const STATUSES: Status[] = ["Pendiente", "En Progreso", "Completada"];
const FILTERS: [Filter, string][] = [
  ["all", "Todas"],
  ["active", "Activas"],
  ["completed", "Hechas"],
];
const emptyForm = { title: "", description: "" };
const emptyEdit = { id: null as string | null, title: "", description: "" };

const isLocalId = (id: string) => !/^[a-f0-9]{24}$/i.test(id);
const isStatus = (value: unknown): value is Status =>
  typeof value === "string" && STATUSES.includes(value as Status);
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

function normalizeTask(value: unknown): Task {
  const task = record(value);
  return {
    _id: String(task._id ?? task.id ?? crypto.randomUUID()),
    title: text(task.title, "(sin título)"),
    description: text(task.description),
    status: isStatus(task.status) ? task.status : "Pendiente",
    clienteId: task.clienteId ? String(task.clienteId) : undefined,
    createdAt: task.createdAt ? String(task.createdAt) : undefined,
    deleted: Boolean(task.deleted),
    pending: Boolean(task.pending),
  };
}

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [edit, setEdit] = useState(emptyEdit);
  const [online, setOnline] = useState(navigator.onLine);

  const loadFromServer = useCallback(async () => {
    try {
      const raw = record((await api.get("/tasks")).data);
      const list = Array.isArray(raw.items) ? raw.items.map(normalizeTask) : [];
      setTasks(list);
      await cacheTasks(list);
    } catch {
      // Si falla internet, se conserva la cache local.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setAuth(localStorage.getItem("token"));

    const handleOnline = async () => {
      setOnline(true);
      await syncNow();
      await loadFromServer();
    };
    const handleOffline = () => setOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    void (async () => {
      const local = await getAllTasksLocal();
      if (local.length) setTasks(local.map(normalizeTask));
      setLoading(false);
      await loadFromServer();
      await syncNow();
      await loadFromServer();
    })();

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [loadFromServer]);

  async function addTask(event: FormEvent) {
    event.preventDefault();
    const title = form.title.trim();
    const description = form.description.trim();
    if (!title) return;

    const clienteId = crypto.randomUUID();
    const localTask = normalizeTask({
      _id: clienteId,
      title,
      description,
      status: "Pendiente",
      pending: true,
    });

    setTasks((current) => [localTask, ...current]);
    await putTaskLocal(localTask);
    setForm(emptyForm);

    if (!navigator.onLine) return enqueueCreate(clienteId, localTask);

    try {
      const { data } = await api.post("/tasks", { title, description });
      const created = normalizeTask(record(data).task ?? data);
      setTasks((current) => current.map((task) => (task._id === clienteId ? created : task)));
      await putTaskLocal(created);
    } catch {
      setTasks((current) =>
        current.map((task) => (task._id === clienteId ? { ...task, pending: true } : task))
      );
      await putTaskLocal({ ...localTask, pending: true });
      await enqueueCreate(clienteId, localTask);
    }
  }

  async function updateTask(taskId: string, changes: Changes) {
    const current = tasks.find((task) => task._id === taskId);
    if (!current) return;

    const updated = { ...current, ...changes, pending: current.pending || !navigator.onLine };
    setTasks((list) => list.map((task) => (task._id === taskId ? updated : task)));
    await putTaskLocal(updated);

    if (!navigator.onLine) return enqueueUpdate(taskId, changes);

    try {
      await api.put(`/tasks/${taskId}`, changes);
    } catch {
      const pendingTask = { ...updated, pending: true };
      setTasks((list) => list.map((task) => (task._id === taskId ? pendingTask : task)));
      await putTaskLocal(pendingTask);
      await enqueueUpdate(taskId, changes);
    }
  }

  async function saveEdit(taskId: string) {
    const title = edit.title.trim();
    if (!title) return;
    await updateTask(taskId, { title, description: edit.description.trim() });
    setEdit(emptyEdit);
  }

  async function removeTask(taskId: string) {
    const backup = tasks;
    setTasks((list) => list.filter((task) => task._id !== taskId));
    await removeTaskLocal(taskId);

    if (!navigator.onLine) return enqueueDelete(taskId);

    try {
      await api.delete(`/tasks/${taskId}`);
    } catch {
      setTasks(backup);
      await Promise.all(backup.map(putTaskLocal));
      await enqueueDelete(taskId);
    }
  }

  function logout() {
    localStorage.removeItem("token");
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
    return { total, done, pending: total - done };
  }, [tasks]);

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
          <span className={online ? "connection online" : "connection offline"}>
            <span className="connection-dot" />
            {online ? "En línea" : "Sin conexión"}
          </span>
          <button className="btn btn-danger btn-compact" onClick={logout}>Salir</button>
        </div>
      </header>

      <main className="dashboard-main">
        <section className="summary-strip" aria-label="Resumen de tareas">
          <div><strong>{stats.total}</strong><span>Total</span></div>
          <div><strong>{stats.pending}</strong><span>Pendientes</span></div>
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
            <button className="btn btn-primary add-button">+ Agregar tarea</button>
          </form>
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
                        </>
                      ) : (
                        <>
                          <span
                            className="task-title"
                            onDoubleClick={() =>
                              setEdit({ id: task._id, title: task.title, description: task.description ?? "" })
                            }
                          >
                            {task.title}
                          </span>
                          {task.description && <p className="task-description">{task.description}</p>}
                          {(task.pending || isLocalId(task._id)) && (
                            <span className="sync-badge" title="Aún no sincronizada">Falta sincronizar</span>
                          )}
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
                          onClick={() =>
                            setEdit({ id: task._id, title: task.title, description: task.description ?? "" })
                          }
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
      </main>
    </div>
  );
}
