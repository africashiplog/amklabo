"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useId, useRef, type FormEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/server/action";
import { Alert, Button, cx, Input, Label, Select, Textarea, type Variant } from "./ui";

const FormStateContext = createContext<ActionState>({});
const PendingContext = createContext<boolean | null>(null);

type ServerAction = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/**
 * React 19 vide automatiquement un formulaire après chaque envoi, y compris en
 * cas d'erreur, ce qui ferait perdre la saisie. On envoie donc les données
 * nous-mêmes (sans réinitialisation) ; sans JavaScript, l'attribut action
 * natif reste utilisé.
 */
function useKeepValuesSubmit(formAction: (fd: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => formAction(fd));
  };
}

/**
 * Formulaire relié à une action serveur : affiche le message global et
 * fournit les erreurs par champ aux composants <Field>.
 */
export function ActionForm({ action, children, className, resetOnSuccess, showSuccess = true }: {
  action: ServerAction; children: ReactNode; className?: string; resetOnSuccess?: boolean; showSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  const onSubmit = useKeepValuesSubmit(formAction);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <FormStateContext.Provider value={state}>
     <PendingContext.Provider value={pending}>
      <form ref={ref} action={formAction} onSubmit={onSubmit} className={cx("space-y-4", className)} noValidate>
        {state.message && (state.ok === false || showSuccess) && (
          <Alert tone={state.ok ? "success" : "error"}>{state.message}</Alert>
        )}
        {children}
      </form>
     </PendingContext.Provider>
    </FormStateContext.Provider>
  );
}

export function useFieldError(name: string) {
  return useContext(FormStateContext).fieldErrors?.[name];
}

type FieldProps = {
  name: string; label: string; hint?: string; className?: string;
} & (
  | ({ as?: "input" } & React.ComponentProps<"input">)
  | ({ as: "textarea" } & React.ComponentProps<"textarea">)
  | ({ as: "select"; children: ReactNode } & React.ComponentProps<"select">)
);

export function Field({ name, label, hint, className, as = "input", ...rest }: FieldProps) {
  const id = useId();
  const error = useFieldError(name);
  const common = { id, name, "aria-invalid": error ? true : undefined, "aria-describedby": error ? `${id}-err` : undefined };
  return (
    <div className={cx("min-w-0", className)}>
      <Label htmlFor={id} hint={hint}>{label}</Label>
      {as === "textarea" ? (
        <Textarea {...common} {...(rest as React.ComponentProps<"textarea">)} />
      ) : as === "select" ? (
        <Select {...common} {...(rest as React.ComponentProps<"select">)} />
      ) : (
        <Input {...common} {...(rest as React.ComponentProps<"input">)} />
      )}
      {error && <p id={`${id}-err`} className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export function Checkbox({ name, label, defaultChecked, value = "on" }: { name: string; label: string; defaultChecked?: boolean; value?: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600" />
      {label}
    </label>
  );
}

export function SubmitButton({ children, variant = "primary", size, className, pendingLabel = "Enregistrement…" }: {
  children: ReactNode; variant?: Variant; size?: "sm" | "md"; className?: string; pendingLabel?: string;
}) {
  const status = useFormStatus();
  const ctxPending = useContext(PendingContext);
  const pending = ctxPending ?? status.pending;
  return (
    <Button type="submit" variant={variant} size={size} disabled={pending} className={className} aria-busy={pending}>
      {pending ? pendingLabel : children}
    </Button>
  );
}

/**
 * Bouton d'action destructrice ou sensible : ouvre une fenêtre de
 * confirmation décrivant précisément l'élément concerné et les conséquences.
 */
export function ConfirmAction({ action, fields, label, title, description, confirmLabel = "Confirmer", variant = "danger", size = "sm", children }: {
  action: ServerAction; fields: Record<string, string>; label: string; title: string; description: ReactNode;
  confirmLabel?: string; variant?: Variant; size?: "sm" | "md"; children?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const dialog = useRef<HTMLDialogElement>(null);
  const onSubmit = useKeepValuesSubmit(formAction);
  useEffect(() => {
    if (state.ok) dialog.current?.close();
  }, [state]);
  return (
    <>
      <Button type="button" variant={variant === "danger" ? "secondary" : variant} size={size}
        className={variant === "danger" ? "text-red-700" : undefined}
        onClick={() => dialog.current?.showModal()}>
        {label}
      </Button>
      {state.ok && state.message && <p role="status" className="mt-1 text-xs text-leaf-700">{state.message}</p>}
      <dialog ref={dialog} className="w-[min(32rem,calc(100vw-2rem))] rounded-xl p-0 shadow-xl backdrop:bg-slate-900/40">
        <PendingContext.Provider value={pending}>
        <form action={formAction} onSubmit={onSubmit} className="space-y-4 p-6">
          {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <div className="text-sm text-slate-600">{description}</div>
          {children && <FormStateContext.Provider value={state}>{children}</FormStateContext.Provider>}
          {state.ok === false && state.message && <Alert tone="error">{state.message}</Alert>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => dialog.current?.close()}>Annuler</Button>
            <SubmitButton variant={variant} pendingLabel="Traitement…">{confirmLabel}</SubmitButton>
          </div>
        </form>
        </PendingContext.Provider>
      </dialog>
    </>
  );
}

/** Petit formulaire à un bouton (actions non destructrices). */
export function InlineAction({ action, fields, children, variant = "secondary" }: {
  action: ServerAction; fields: Record<string, string>; children: ReactNode; variant?: Variant;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="inline">
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <SubmitButton variant={variant} size="sm" pendingLabel="…">{children}</SubmitButton>
      {state.ok === false && state.message && <span role="alert" className="ms-2 text-xs text-red-700">{state.message}</span>}
    </form>
  );
}

