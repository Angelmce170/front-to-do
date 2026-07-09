import type { Project } from "./types";
import PdfAttachmentPreview from "./PdfAttachmentPreview";

type Props = {
  project: Project;
  onClose: () => void;
};

export default function ProjectAttachmentModal({ project, onClose }: Props) {
  if (!project.attachment?.dataUrl) return null;
  const isPdf =
    project.attachment.type === "application/pdf" ||
    Boolean(project.attachment.name?.toLowerCase().endsWith(".pdf"));

  return (
    <div className="project-modal" role="dialog" aria-modal="true">
      <div className="project-modal-content">
        <button className="icon-button" type="button" onClick={onClose}>
          ×
        </button>
        <h3>{project.attachment.name}</h3>
        {isPdf ? (
          <PdfAttachmentPreview dataUrl={project.attachment.dataUrl} />
        ) : project.attachment.type?.startsWith("image/") ? (
          <img src={project.attachment.dataUrl} alt={project.attachment.name || "Archivo"} />
        ) : (
          <iframe title={project.attachment.name} src={project.attachment.dataUrl} />
        )}
      </div>
    </div>
  );
}
