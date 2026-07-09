import type { ChatScope, Project, ProjectFormEvent, ProjectMember, ProjectMessage, UserMini } from "./types";

type Props = {
  project: Project;
  currentUser: UserMini | null;
  otherMembers: ProjectMember[];
  messages: ProjectMessage[];
  open: boolean;
  scope: ChatScope;
  to: string;
  text: string;
  onOpenChange: (open: boolean) => void;
  onScopeChange: (scope: ChatScope) => void;
  onToChange: (userId: string) => void;
  onTextChange: (text: string) => void;
  onSend: (event: ProjectFormEvent) => void;
  onActivity: (area: string, action: string) => void;
};

export default function ProjectChat({
  project,
  currentUser,
  otherMembers,
  messages,
  open,
  scope,
  to,
  text,
  onOpenChange,
  onScopeChange,
  onToChange,
  onTextChange,
  onSend,
  onActivity,
}: Props) {
  return (
    <div className={open ? "project-chat open" : "project-chat"}>
      <button className="chat-bubble" type="button" onClick={() => onOpenChange(!open)}>
        <span>Chat</span>
        {open ? "×" : "Abrir"}
      </button>
      {open && (
        <div className="chat-panel">
          <div className="chat-panel-head">
            <strong>{project.title}</strong>
            <div className="segmented-control small">
              <button
                className={scope === "group" ? "active" : ""}
                type="button"
                onClick={() => onScopeChange("group")}
              >
                Todos
              </button>
              <button
                className={scope === "direct" ? "active" : ""}
                type="button"
                onClick={() => {
                  onScopeChange("direct");
                  onToChange(to || otherMembers[0]?.user?.id || "");
                }}
              >
                Directo
              </button>
            </div>
          </div>
          {scope === "direct" && (
            <select value={to} onChange={(event) => onToChange(event.target.value)}>
              {otherMembers.map((member) => (
                <option key={member.user?.id} value={member.user?.id}>
                  {member.user?.name}
                </option>
              ))}
            </select>
          )}
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
          </div>
          <form onSubmit={onSend}>
            <input
              value={text}
              onChange={(event) => onTextChange(event.target.value)}
              onFocus={() => onActivity("chat", "escribiendo en el chat")}
              placeholder="Mensaje"
            />
            <button className="btn btn-primary">Enviar</button>
          </form>
        </div>
      )}
    </div>
  );
}
