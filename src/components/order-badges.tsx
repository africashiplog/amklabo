import { Badge } from "./ui";
import { ORDER_STATUS, PAYMENT_STATUS, type OrderStatus } from "@/server/services/orders";

const tone: Record<OrderStatus, "slate" | "blue" | "green" | "amber" | "red"> = {
  new: "amber", pending_confirmation: "amber", confirmed: "blue", preparing: "blue", ready_to_ship: "blue",
  out_for_delivery: "blue", delivered: "green", cancelled: "red", returned: "slate",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={tone[status]}>{ORDER_STATUS[status]}</Badge>;
}

export function PaymentStatusBadge({ status }: { status: keyof typeof PAYMENT_STATUS }) {
  return <Badge tone={status === "paid" ? "green" : status === "refused" || status === "failed" ? "red" : "slate"}>{PAYMENT_STATUS[status]}</Badge>;
}
