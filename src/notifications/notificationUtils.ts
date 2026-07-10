import type { ProjectAlert } from "../projects/types";

function textData(alert: ProjectAlert, key: string) {
  const data = alert.data && typeof alert.data === "object" ? alert.data : {};
  const value = data[key];
  return typeof value === "string" ? value : "";
}

export function notificationUrl(alert: ProjectAlert) {
  const projectId = textData(alert, "projectId") || alert.project?._id || "";
  if (!projectId) return "/dashboard";

  const params = new URLSearchParams({ project: projectId });
  const chat = textData(alert, "chat");
  const chatUser = textData(alert, "chatUserId");

  if (chat === "group" || chat === "direct") params.set("chat", chat);
  if (chatUser) params.set("chatUser", chatUser);

  return `/dashboard?${params.toString()}`;
}

export function formatNotificationDate(value: string) {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
