import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { formatDate, projectFromResponse } from "./projectUtils";
import type { Project, ProjectPresence, UserMini } from "./types";

type Props = {
  project: Project;
  currentUser: UserMini | null;
  editors: ProjectPresence[];
  onSaved: (project: Project) => void;
  onActivity: (area: string, action: string) => void;
};

const maxDocumentLength = 50_000;

function projectDocument(project: Project) {
  return project.document || {
    content: "",
    updatedBy: null,
    updatedAt: null,
    version: 0,
  };
}

export default function ProjectDocumentEditor({ project, currentUser, editors, onSaved, onActivity }: Props) {
  const documentInfo = projectDocument(project);
  const [draft, setDraft] = useState(documentInfo.content);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const projectIdRef = useRef(project._id);
  const latestDraftRef = useRef(documentInfo.content);
  const lastVersionRef = useRef(documentInfo.version);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const savingRef = useRef(false);
  const queuedSaveRef = useRef<string | null>(null);

  const activeEditors = useMemo(() => {
    const unique = new Map<string, UserMini>();

    for (const editor of editors) {
      if (editor.user?.id && editor.user.id !== currentUser?.id) {
        unique.set(editor.user.id, editor.user);
      }
    }

    return [...unique.values()];
  }, [currentUser?.id, editors]);

  const canEdit = project.myStatus === "active";
  const saveState = saving ? "Guardando" : dirty ? "Pendiente" : "Guardado";
  const saveStateClass = saving ? "saving" : dirty ? "pending" : "saved";

  useEffect(() => {
    const nextDocument = projectDocument(project);

    if (project._id !== projectIdRef.current) {
      window.clearTimeout(saveTimerRef.current);
      projectIdRef.current = project._id;
      latestDraftRef.current = nextDocument.content;
      lastVersionRef.current = nextDocument.version;
      queuedSaveRef.current = null;
      savingRef.current = false;
      setDraft(nextDocument.content);
      setDirty(false);
      setSaving(false);
      setMessage("");
      return;
    }

    if (!dirty && nextDocument.version !== lastVersionRef.current) {
      latestDraftRef.current = nextDocument.content;
      lastVersionRef.current = nextDocument.version;
      setDraft(nextDocument.content);
      setMessage("");
    }
  }, [dirty, project]);

  useEffect(() => () => window.clearTimeout(saveTimerRef.current), []);

  async function saveDocument(projectId = project._id, content = latestDraftRef.current) {
    if (!canEdit) return;

    if (savingRef.current) {
      queuedSaveRef.current = content;
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setMessage("");

    try {
      const { data } = await api.patch(`/projects/${projectId}/document`, { content });
      const nextProject = projectFromResponse(data.project);
      onSaved(nextProject);

      if (projectIdRef.current === projectId && latestDraftRef.current === content) {
        setDirty(false);
        setMessage("Guardado");
        lastVersionRef.current = projectDocument(nextProject).version;
      }
    } catch {
      setDirty(true);
      setMessage("No se pudo guardar.");
    } finally {
      savingRef.current = false;
      setSaving(false);

      const queuedContent = queuedSaveRef.current;
      queuedSaveRef.current = null;
      if (queuedContent !== null && queuedContent !== content && projectIdRef.current === projectId) {
        window.setTimeout(() => void saveDocument(projectId, queuedContent), 0);
      }
    }
  }

  function handleChange(value: string) {
    const nextContent = value.slice(0, maxDocumentLength);
    latestDraftRef.current = nextContent;
    setDraft(nextContent);
    setDirty(true);
    setMessage("");
    onActivity("documento", "editando el documento");

    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void saveDocument(project._id, nextContent);
    }, 900);
  }

  const lastUpdate = documentInfo.updatedAt
    ? `${documentInfo.updatedBy?.name || "Usuario"} - ${formatDate(documentInfo.updatedAt)}`
    : "Sin ediciones";

  return (
    <section className="project-card document-editor-card">
      <div className="document-editor-head">
        <div>
          <p className="eyebrow">DOCUMENTO</p>
          <h4>Editor del proyecto</h4>
          <span>{lastUpdate}</span>
        </div>
        <span className={`document-save-state ${saveStateClass}`}>{canEdit ? saveState : "Solo lectura"}</span>
      </div>

      {activeEditors.length > 0 && (
        <div className="document-presence">
          {activeEditors.map((editor) => (
            <span key={editor.id}>
              <b style={{ backgroundColor: editor.avatarColor || "#2a8b7b" }}>
                {editor.name.trim().charAt(0).toUpperCase() || "U"}
              </b>
              {editor.name} está editando
            </span>
          ))}
        </div>
      )}

      <label className="document-editor-field">
        <span>Contenido</span>
        <textarea
          value={draft}
          disabled={!canEdit}
          maxLength={maxDocumentLength}
          onChange={(event) => handleChange(event.target.value)}
          onFocus={() => onActivity("documento", "editando el documento")}
          placeholder="Escribe aquí el documento del proyecto"
          rows={16}
        />
      </label>

      <div className="document-editor-foot">
        <span>{draft.length.toLocaleString("es-MX")}/{maxDocumentLength.toLocaleString("es-MX")} caracteres</span>
        <button
          className="btn btn-compact"
          type="button"
          disabled={!canEdit || saving || !dirty}
          onClick={() => {
            window.clearTimeout(saveTimerRef.current);
            void saveDocument(project._id, latestDraftRef.current);
          }}
        >
          Guardar ahora
        </button>
      </div>

      {message && <p className="inline-message">{message}</p>}
    </section>
  );
}
