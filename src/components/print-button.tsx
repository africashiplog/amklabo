"use client";

import { Button } from "./ui";

export function PrintButton() {
  return <Button type="button" variant="secondary" onClick={() => window.print()}>Imprimer</Button>;
}
