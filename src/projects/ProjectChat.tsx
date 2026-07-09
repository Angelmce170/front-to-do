import type { ChatScope, Project, ProjectFormEvent, ProjectMember, ProjectMessage, UserMini } from "./types";

type ChatUnreadInfo = {
  count: number;
  senders: string[];
};

type Props = {
  project: Project;
  currentUser: UserMini | null;
  otherMembers: ProjectMember[];
  messages: ProjectMessage[];
  open: boolean;
  scope: ChatScope;
  to: string;
  text: string;
  unreadTotal: number;
  unreadByChannel: Record<string, ChatUnreadInfo>;
  onOpenChange: (open: boolean) => void;
  onScopeChange: (scope: ChatScope) => void;
  onToChange: (userId: string) => void;
  onTextChange: (text: string) => void;
  onSend: (event: ProjectFormEvent) => void;
  onActivity: (area: string, action: string) => void;
};

const channelKey = (scope: ChatScope, userId = "") => (scope === "group" ? "group" : `direct:${userId}`);

function avatarInitial(name?: string) {
  return name?.trim().charAt(0).toUpperCase() || "U";
}

function senderSummary(info?: ChatUnreadInfo) {
  if (!info?.senders.length) return "";
  return `de ${info.senders.slice(0, 2).join(", ")}${info.senders.length > 2 ? "..." : ""}`;
}

export default function ProjectChat({
  project,
  currentUser,
  otherMembers,
  messages,
  open,
  scope,
  to,
  text,
  unreadTotal,
  unreadByChannel,
  onOpenChange,
  onScopeChange,
  onToChange,
  onTextChange,
  onSend,
  onActivity,
}: Props) {
  const selectedChannel = channelKey(scope, to);
  const activeName =
    scope === "group"
      ? "Grupo"
      : otherMembers.find((member) => member.user?.id === to)?.user?.name || "Directo";

  function selectGroup() {
    onScopeChange("group");
    onToChange("");
  }

  function selectDirect(userId: string) {
    onScopeChange("direct");
    onToChange(userId);
  }

  return (
    <div className={open ? "project-chat open" : "project-chat"}>
      <button className="chat-bubble" type="button" onClick={() => onOpenChange(!open)}>
        <span>Chat</span>
        {unreadTotal > 0 && <strong className="chat-bubble-count">{unreadTotal}</strong>}
        {open ? "Cerrar" : "Abrir"}
      </button>

      {open && (
        <div className="chat-panel">
          <div className="chat-panel-head">
            <div>
              <strong>{project.title}</strong>
              <small>{activeName}</small>
            </div>
            {unreadTotal > 0 && (
              <span className="chat-unread-summary">
                {unreadTotal} sin leer
              </span>
            )}
          </div>

          <div className="chat-panel-body">
            <aside className="chat-channel-list" aria-label="Conversaciones del proyecto">
              <button
                className={selectedChannel === "group" ? "chat-channel active" : "chat-channel"}
                type="button"
                onClick={selectGroup}
              >
                <span className="chat-avatar group" aria-hidden="true">G</span>
                <span className="chat-channel-text">
                  <strong>Grupo</strong>
                  <small>{senderSummary(unreadByChannel.group) || "Todos"}</small>
                </span>
                {unreadByChannel.group?.count > 0 && (
                  <span className="chat-unread-count">{unreadByChannel.group.count}</span>
                )}
              </button>

              {otherMembers.map((member) => {
                const user = member.user;
                if (!user) return null;

                const key = channelKey("direct", user.id);
                const unread = unreadByChannel[key];

                return (
                  <button
                    key={user.id}
                    className={selectedChannel === key ? "chat-channel active" : "chat-channel"}
                    type="button"
                    onClick={() => selectDirect(user.id)}
                  >
                    <span
                      className="chat-avatar"
                      style={{ backgroundColor: user.avatarColor || "#2a8b7b" }}
                      aria-hidden="true"
                    >
                      {avatarInitial(user.name)}
                    </span>
                    <span className="chat-channel-text">
                      <strong>{user.name}</strong>
                      <small>{unread?.count ? senderSummary(unread) : user.email}</small>
                    </span>
                    {unread?.count > 0 && <span className="chat-unread-count">{unread.count}</span>}
                  </button>
                );
              })}
            </aside>

            <div className="chat-dialog">
              <div className="chat-messages">
                {messages.map((message) => (
                  <p
                    key={message._id}
                    className={message.author?.id === currentUser?.id ? "own" : ""}
                  >
                    <strong>{message.author?.name || "Usuario"}</strong>
                    <span>{message.text}</span>
                  </p>
                ))}
                {!messages.length && (
                  <p className="chat-empty">
                    <strong>{activeName}</strong>
                    <span>Sin mensajes todavía.</span>
                  </p>
                )}
              </div>

              <form onSubmit={onSend}>
                <input
                  value={text}
                  onChange={(event) => onTextChange(event.target.value)}
                  onFocus={() => onActivity("chat", "escribiendo en el chat")}
                  placeholder={scope === "group" ? "Mensaje para el grupo" : `Mensaje para ${activeName}`}
                  disabled={scope === "direct" && !to}
                />
                <button className="btn btn-primary" disabled={scope === "direct" && !to}>
                  Enviar
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
