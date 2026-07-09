import type { FormEvent } from "react";

export type UserMini = {
  id: string;
  name: string;
  email: string;
  avatarColor?: string;
};

export type ProjectAttachment = {
  name?: string;
  type?: string;
  size?: number;
  dataUrl?: string;
};

export type ProjectMember = {
  user: UserMini | null;
  role: "leader" | "member";
  status: "active" | "invited";
};

export type ProjectComment = {
  _id: string;
  author: UserMini | null;
  message: string;
  createdAt: string;
};

export type ProjectTask = {
  _id: string;
  title: string;
  description?: string;
  assignedTo: UserMini | null;
  dueAt?: string | null;
  status: "Pendiente" | "En Progreso" | "Completada";
  comments?: ProjectComment[];
};

export type ProjectMessage = {
  _id: string;
  scope: "group" | "direct";
  to?: UserMini | null;
  author: UserMini | null;
  text: string;
  createdAt: string;
};

export type ProjectPresence = {
  user: UserMini | null;
  area: string;
  action: string;
};

export type ProjectActivity = {
  _id: string;
  user: UserMini | null;
  text: string;
  area: string;
  createdAt: string;
};

export type Project = {
  _id: string;
  title: string;
  description?: string;
  mode: "individual" | "group";
  participantLimit: number;
  inviteCode: string;
  creator: UserMini | null;
  members: ProjectMember[];
  pendingEmails?: { email: string }[];
  attachment?: ProjectAttachment;
  tasks: ProjectTask[];
  messages: ProjectMessage[];
  presence: ProjectPresence[];
  activity: ProjectActivity[];
  myStatus: "active" | "invited" | "";
  myRole: "leader" | "member";
  isLeader: boolean;
};

export type ProjectAlert = {
  _id: string;
  title: string;
  body: string;
  read: boolean;
  type: string;
  data?: Record<string, unknown>;
  project?: { _id: string; title: string };
  createdAt: string;
};

export type ProjectForm = {
  title: string;
  description: string;
  mode: "individual" | "group";
  participantLimit: number;
};

export type ProjectTaskForm = {
  title: string;
  description: string;
  assignedTo: string;
  dueAt: string;
};

export type ProjectView = "overview" | "tasks" | "schedule";
export type ChatScope = "group" | "direct";
export type ProjectFormEvent = FormEvent<HTMLFormElement>;
