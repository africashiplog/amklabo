import { ConfirmAction, Field } from "./forms";
import { reviewBusinessAction } from "@/app/admin/customer-actions";

/** Boutons de décision sur un compte professionnel, selon son statut. */
export function BusinessReviewButtons({ id, status, name }: { id: string; status: string; name: string }) {
  const reason = <Field name="reason" label="Motif (communiqué au client)" as="textarea" rows={3} />;
  return (
    <div className="flex flex-wrap gap-2">
      {status === "pending" && (
        <>
          <ConfirmAction action={reviewBusinessAction} fields={{ id, decision: "approve" }} label="Approuver" variant="success"
            title={`Approuver « ${name} » ?`} confirmLabel="Approuver"
            description="Le client aura immédiatement accès aux tarifs professionnels et aux prix négociés éventuels." />
          <ConfirmAction action={reviewBusinessAction} fields={{ id, decision: "reject" }} label="Refuser"
            title={`Refuser la demande de « ${name} » ?`} confirmLabel="Refuser"
            description="Le client conservera son compte particulier et pourra déposer une nouvelle demande.">{reason}</ConfirmAction>
        </>
      )}
      {status === "approved" && (
        <ConfirmAction action={reviewBusinessAction} fields={{ id, decision: "suspend" }} label="Suspendre l'accès pro"
          title={`Suspendre le compte professionnel de « ${name} » ?`} confirmLabel="Suspendre"
          description="Les tarifs de gros et prix négociés cesseront immédiatement de s'appliquer. Le compte client reste actif.">{reason}</ConfirmAction>
      )}
      {status === "suspended" && (
        <ConfirmAction action={reviewBusinessAction} fields={{ id, decision: "reinstate" }} label="Rétablir l'accès pro" variant="success"
          title={`Rétablir le compte professionnel de « ${name} » ?`} confirmLabel="Rétablir"
          description="Les tarifs professionnels s'appliqueront de nouveau." />
      )}
    </div>
  );
}
