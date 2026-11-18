import { type FormEvent, useState } from "react";
import { Alert, Badge, Button, Card, Field, PageHeader, SelectField, Spinner } from "../components/ui.tsx";
import { useAuth } from "../auth/AuthContext.tsx";
import { billingApi, storesApi } from "../lib/endpoints.ts";
import { errorMessage } from "../lib/errors.ts";
import { formatDate, roleLabel } from "../lib/format.ts";
import type { AssignableRole } from "../lib/types.ts";
import { useLoad } from "../lib/useLoad.ts";
import { validateEmail } from "../lib/validation.ts";
import { useWorkspace } from "../workspace/WorkspaceContext.tsx";

const ROLES: AssignableRole[] = ["ADMIN", "PHOTOGRAPHER", "EDITOR"];

export function TeamPage() {
  const { user } = useAuth();
  const { currentStore } = useWorkspace();
  const storeId = currentStore?.id ?? "";
  const canManage = currentStore?.role === "OWNER" || currentStore?.role === "ADMIN";
  const isOwner = currentStore?.role === "OWNER";

  const features = useLoad(() => billingApi.features(storeId), [storeId]);
  const members = useLoad(() => storesApi.members(storeId), [storeId]);
  const invitations = useLoad(
    () => (canManage ? storesApi.invitations(storeId) : Promise.resolve({ invitations: [] })),
    [storeId, canManage],
  );

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AssignableRole>("PHOTOGRAPHER");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!currentStore) return <Spinner />;

  const teamEnabled = features.data?.entitlements["team.enabled"]?.enabled ?? false;
  const maxMembers = features.data?.entitlements["team.max_members"]?.limitValue ?? null;

  async function run(action: () => Promise<unknown>, success: string) {
    setFormError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
      members.reload();
      invitations.reload();
    } catch (caught) {
      setFormError(errorMessage(caught));
    }
  }

  async function onInvite(event: FormEvent) {
    event.preventDefault();
    const invalid = validateEmail(email);
    setEmailError(invalid);
    if (invalid) return;

    setBusy(true);
    await run(() => storesApi.invite(storeId, { email: email.trim(), role }), "Invitación enviada.");
    setEmail("");
    setBusy(false);
  }

  const pending = invitations.data?.invitations.filter((i) => i.status === "pending") ?? [];

  return (
    <>
      <PageHeader title="Equipo" subtitle="Personas con acceso a esta tienda." />

      <div className="space-y-4">
        {formError ? <Alert>{formError}</Alert> : null}
        {notice ? <Alert tone="ok">{notice}</Alert> : null}
        {!features.loading && !teamEnabled ? (
          <Alert tone="info">Tu plan actual no incluye gestión de equipo.</Alert>
        ) : null}

        <Card title="Miembros" action={maxMembers !== null ? <Badge>máx. {maxMembers}</Badge> : undefined}>
          {members.loading ? (
            <Spinner />
          ) : members.error ? (
            <Alert>{errorMessage(members.error)}</Alert>
          ) : (
            <ul className="divide-y divide-line">
              {members.data?.members
                .filter((m) => m.status !== "removed")
                .map((member) => {
                  const editable = canManage && member.role !== "OWNER" && member.userId !== user?.id;
                  const adminLocked = member.role === "ADMIN" && !isOwner;

                  return (
                    <li key={member.membershipId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div>
                        <p className="text-sm text-fg">{member.displayName ?? member.email}</p>
                        <p className="text-xs text-fg-dim">{member.email}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {editable && !adminLocked ? (
                          <>
                            <select
                              aria-label={`Rol de ${member.email}`}
                              value={member.role}
                              onChange={(e) =>
                                void run(
                                  () => storesApi.updateMember(storeId, member.userId, e.target.value as AssignableRole),
                                  "Rol actualizado.",
                                )
                              }
                              className="border-0 border-b border-line bg-raised px-2 py-1 text-sm text-fg"
                            >
                              {ROLES.filter((r) => isOwner || r !== "ADMIN").map((r) => (
                                <option key={r} value={r}>
                                  {roleLabel(r)}
                                </option>
                              ))}
                            </select>
                            <Button
                              variant="danger"
                              onClick={() => {
                                if (window.confirm(`¿Quitar a ${member.email} de la tienda?`)) {
                                  void run(() => storesApi.removeMember(storeId, member.userId), "Miembro quitado.");
                                }
                              }}
                            >
                              Quitar
                            </Button>
                          </>
                        ) : (
                          <Badge>{roleLabel(member.role)}</Badge>
                        )}
                        {member.status !== "active" ? <Badge tone="warn">{member.status}</Badge> : null}
                      </div>
                    </li>
                  );
                })}
            </ul>
          )}
        </Card>

        {canManage ? (
          <>
            <Card title="Invitar">
              <form onSubmit={onInvite} className="grid gap-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end" noValidate>
                <Field label="Email" type="email" value={email} error={emailError} onChange={(e) => setEmail(e.target.value)} />
                <SelectField label="Rol" value={role} onChange={(e) => setRole(e.target.value as AssignableRole)}>
                  {ROLES.filter((r) => isOwner || r !== "ADMIN").map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </SelectField>
                <Button type="submit" loading={busy} disabled={!teamEnabled}>
                  Invitar
                </Button>
              </form>
            </Card>

            <Card title="Invitaciones pendientes">
              {pending.length === 0 ? (
                <p className="text-sm text-fg-dim">No hay invitaciones pendientes.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {pending.map((invitation) => (
                    <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div>
                        <p className="text-sm text-fg">{invitation.email}</p>
                        <p className="text-xs text-fg-dim">
                          {roleLabel(invitation.role)} · vence {formatDate(invitation.expiresAt)}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        onClick={() => void run(() => storesApi.revokeInvitation(storeId, invitation.id), "Invitación revocada.")}
                      >
                        Revocar
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        ) : null}
      </div>
    </>
  );
}
