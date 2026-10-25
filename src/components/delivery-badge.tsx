import { Badge } from "./ui";
import { DELIVERY_STATUS, type DeliveryStatus } from "@/server/services/deliveries";

const tone = { pending: "amber", assigned: "blue", in_transit: "blue", delivered: "green", failed: "red", cancelled: "slate" } as const;

export function DeliveryBadge({ status }: { status: DeliveryStatus }) {
  return <Badge tone={tone[status]}>{DELIVERY_STATUS[status]}</Badge>;
}
