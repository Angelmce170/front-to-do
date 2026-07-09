import ParticipantLimitField from "./ParticipantLimitField";
import type { ProjectAttachment, ProjectForm, ProjectFormEvent } from "./types";

type Props = {
  form: ProjectForm;
  attachment: ProjectAttachment | null;
  onFormChange: (form: ProjectForm) => void;
  onFileChange: (file?: File) => void;
  onSubmit: (event: ProjectFormEvent) => void;
  onCancel: () => void;
  onActivity: (area: string, action: string) => void;
};

export default function ProjectCreateForm({
  form,
  attachment,
  onFormChange,
  onFileChange,
  onSubmit,
  onCancel,
  onActivity,
}: Props) {
  return (
    <form className="project-card project-create" onSubmit={onSubmit}>
      <div className="project-create-head">
        <div>
          <p className="eyebrow">NUEVO PROYECTO</p>
          <h3>Crear proyecto</h3>
        </div>
        <button className="icon-button" type="button" onClick={onCancel}>
          ×
        </button>
      </div>
      <label className="field">
        <span>Título</span>
        <input
          value={form.title}
          onChange={(event) => onFormChange({ ...form, title: event.target.value })}
          onFocus={() => onActivity("proyecto", "preparando un proyecto")}
          placeholder="Nombre del proyecto"
        />
      </label>
      <label className="field">
        <span>Descripción</span>
        <textarea
          value={form.description}
          onChange={(event) => onFormChange({ ...form, description: event.target.value })}
          rows={2}
          placeholder="Objetivo, entregables o contexto"
        />
      </label>
      <div className="segmented-control">
        <button
          className={form.mode === "individual" ? "active" : ""}
          type="button"
          onClick={() => onFormChange({ ...form, mode: "individual" })}
        >
          Individual
        </button>
        <button
          className={form.mode === "group" ? "active" : ""}
          type="button"
          onClick={() => onFormChange({ ...form, mode: "group" })}
        >
          Grupo
        </button>
      </div>
      {form.mode === "group" && (
        <>
          <ParticipantLimitField
            value={form.participantLimit}
            onChange={(participantLimit) => onFormChange({ ...form, participantLimit })}
          />
          <p className="inline-message">Después de crearlo podrás invitar por correo, link, QR o amigos.</p>
        </>
      )}
      <label className="field">
        <span>Archivo interno</span>
        <input type="file" onChange={(event) => onFileChange(event.target.files?.[0])} />
      </label>
      {attachment?.name && <span className="sync-badge">{attachment.name}</span>}
      <div className="project-create-actions">
        <button className="btn btn-primary">Crear proyecto</button>
        <button className="btn btn-compact" type="button" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
