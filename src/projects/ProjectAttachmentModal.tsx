import type { Project } from "./types";

type Props = {
  project: Project;
  onClose: () => void;
};

export default function ProjectAttachmentModal({ project, onClose }: Props) {
  if (!project.attachment?.dataUrl) return null;

  return (
    <div className="project-modal" role="dialog" aria-modal="true">
      <div className="project-modal-content">
        <button className="icon-button" type="button" onClick={onClose}>
          ×
        </button>
        <h3>{project.attachment.name}</h3>
        {project.attachment.type?.startsWith("image/") ? (
          <img src={project.attachment.dataUrl} alt={project.attachment.name || "Archivo"} />
        ) : (
          <iframe title={project.attachment.name} src={project.attachment.dataUrl} />
        )}
      </div>
    </div>
  );
}
