import type { Project, ProjectFormEvent, UserMini } from "./types";

type Props = {
  project: Project;
  joinLink: string;
  inviteEmails: string;
  friends: UserMini[];
  selectedFriendIds: string[];
  friendQuery: string;
  friendResults: UserMini[];
  onInviteEmailsChange: (value: string) => void;
  onFriendQueryChange: (value: string) => void;
  onToggleFriend: (friendId: string, checked: boolean) => void;
  onCopyLink: () => void;
  onInviteByEmail: (event: ProjectFormEvent) => void;
  onInviteFriends: () => void;
  onSearchFriends: (event: ProjectFormEvent) => void;
  onAddFriend: (user: UserMini) => void;
};

export default function ProjectInviteBox({
  project,
  joinLink,
  inviteEmails,
  friends,
  selectedFriendIds,
  friendQuery,
  friendResults,
  onInviteEmailsChange,
  onFriendQueryChange,
  onToggleFriend,
  onCopyLink,
  onInviteByEmail,
  onInviteFriends,
  onSearchFriends,
  onAddFriend,
}: Props) {
  return (
    <div className="share-box">
      <div className="share-link-block">
        <p className="eyebrow">INVITACIÓN</p>
        <strong>Link y QR del proyecto</strong>
        <small>{joinLink}</small>
      </div>
      <img
        src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(joinLink)}`}
        alt="QR de invitación"
      />
      <button className="btn btn-compact" type="button" onClick={onCopyLink}>
        Copiar link
      </button>

      <div className="invite-methods">
        <form className="invite-card" onSubmit={onInviteByEmail}>
          <span>Invitar por correo</span>
          <div className="invite-row">
            <input
              value={inviteEmails}
              onChange={(event) => onInviteEmailsChange(event.target.value)}
              placeholder="correo@ejemplo.com, otro@ejemplo.com"
            />
            <button className="btn btn-compact">Invitar</button>
          </div>
        </form>

        <div className="invite-card">
          <span>Invitar amigos guardados</span>
          <div className="friend-picker compact">
            {friends.length ? (
              friends.map((friend) => (
                <label key={friend.id} className="friend-check">
                  <input
                    type="checkbox"
                    checked={selectedFriendIds.includes(friend.id)}
                    onChange={(event) => onToggleFriend(friend.id, event.target.checked)}
                  />
                  {friend.name}
                </label>
              ))
            ) : (
              <small>Busca usuarios y agrégalos como amigos para tenerlos aquí.</small>
            )}
          </div>
          <button
            className="btn btn-compact"
            type="button"
            disabled={!selectedFriendIds.length || project.members.length >= project.participantLimit}
            onClick={onInviteFriends}
          >
            Invitar seleccionados
          </button>
        </div>

        <form className="invite-card" onSubmit={onSearchFriends}>
          <span>Agregar amigo</span>
          <div className="invite-row">
            <input
              value={friendQuery}
              onChange={(event) => onFriendQueryChange(event.target.value)}
              placeholder="Buscar por nombre o correo"
            />
            <button className="btn btn-compact">Buscar</button>
          </div>
          <div className="friend-results">
            {friendResults.map((user) => (
              <button key={user.id} type="button" onClick={() => onAddFriend(user)}>
                <span>{user.name}</span>
                <small>{user.email}</small>
              </button>
            ))}
          </div>
        </form>
      </div>
    </div>
  );
}
