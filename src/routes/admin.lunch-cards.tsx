import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { CHAT_BUCKET, useSignedUrl } from "@/lib/media";

export const Route = createFileRoute("/admin/lunch-cards")({
  component: AdminLunchCards,
});

type Order = {
  id: string;
  full_name: string;
  student_class: string;
  meeting_time: string;
  meeting_area: string;
  front_url: string;
  back_url: string;
  status: string;
  amount_aed: number;
  created_at: string;
};

function CardImage({ path, label }: { path: string; label: string }) {
  const url = useSignedUrl(CHAT_BUCKET, path);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img
            src={url}
            alt={label}
            className="w-full rounded-xl border border-border object-cover"
            style={{ aspectRatio: "85.6 / 54" }}
          />
        </a>
      ) : (
        <div
          className="flex w-full items-center justify-center rounded-xl bg-surface-2 text-xs text-muted-foreground"
          style={{ aspectRatio: "85.6 / 54" }}
        >
          Loading…
        </div>
      )}
    </div>
  );
}

function AdminLunchCards() {
  const [orders, setOrders] = useState<Order[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void supabase
      .from("lunch_card_orders")
      .select(
        "id, full_name, student_class, meeting_time, meeting_area, front_url, back_url, status, amount_aed, created_at",
      )
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (!cancelled) setOrders((data as Order[] | null) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-xl font-bold">Custom lunch card orders</h1>
        <p className="text-sm text-muted-foreground">
          Every paid order with the two photos and the student's details.
        </p>
      </div>

      {orders === null ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : orders.length === 0 ? (
        <p className="text-sm text-muted-foreground">No orders yet.</p>
      ) : (
        orders.map((order) => (
          <div key={order.id} className="surface-panel rounded-2xl p-4 shadow-lift">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="font-semibold">{order.full_name}</span>
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted-foreground">
                {order.student_class}
              </span>
              <span
                className={
                  order.status === "paid"
                    ? "rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-500"
                    : "rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-500"
                }
              >
                {order.status}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                {order.amount_aed} AED · {new Date(order.created_at).toLocaleString()}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <CardImage path={order.front_url} label="Front" />
              <CardImage path={order.back_url} label="Back" />
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Meeting time</dt>
              <dd>{order.meeting_time}</dd>
              <dt className="text-muted-foreground">Meeting area</dt>
              <dd>{order.meeting_area}</dd>
            </dl>
          </div>
        ))
      )}
    </div>
  );
}
