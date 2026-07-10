import type { Project, ProjectAttachment, ProjectForm, ProjectTaskForm } from "./types";

export const emptyProjectForm: ProjectForm = {
  title: "",
  description: "",
  mode: "individual",
  participantLimit: 5,
};

export const emptyTaskForm: ProjectTaskForm = {
  title: "",
  description: "",
  assigneeIds: [],
  dueAt: "",
};

export function fromDateInput(value: string) {
  return value ? new Date(value).toISOString() : null;
}

export function toDateInput(value?: string | null) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

export function formatDate(value?: string | null) {
  if (!value) return "Sin fecha";

  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function fileToAttachment(file: File) {
  return new Promise<ProjectAttachment>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        dataUrl: String(reader.result || ""),
      });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function projectFromResponse(value: unknown) {
  return value as Project;
}
