import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Loader2,
  LayoutDashboard,
  Users,
  MessagesSquare,
  MessageCircle,
  ArrowLeft,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { checkIsAdmin } from "@/lib/admin";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
});

const NAV = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/conversations", label: "Conversations", icon: MessagesSquare },
  { to: "/admin/messages", label: "Messages", icon: MessageCircle },
];

function AdminLayout() {
  const { user, loading: authLoading } = useAuth();
  const location = useLocation();
  const [status, setStatus] = useState<"checking" | "denied" | "allowed">("checking");

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setStatus("denied");
      return;
    }
    let cancelled = false;
    checkIsAdmin(user.id).then((isAdmin) => {
      if (!cancelled) setStatus(isAdmin ? "allowed" : "denied");
    });
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  if (authLoading || status === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (status === "denied") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-sm text-center">
          <h1 className="text-xl font-semibold text-foreground">Access denied</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You don't have permission to view this page.
          </p>
          <Link
            to="/chat"
            className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Back to ZChat
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface/50 md:flex">
        <div className="px-4 py-5">
          <div className="font-display text-sm font-bold tracking-wide text-foreground">
            ZCHAT ADMIN
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-2">
          {NAV.map((item) => {
            const active = item.exact
              ? location.pathname === item.to
              : location.pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
                )}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border p-2">
          <Link
            to="/chat"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-surface-2 hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Back to ZChat
          </Link>
        </div>
      </aside>

      <div className="fixed inset-x-0 top-0 z-10 flex items-center gap-1 overflow-x-auto border-b border-border bg-surface/90 px-2 py-2 backdrop-blur md:hidden">
        {NAV.map((item) => {
          const active = item.exact
            ? location.pathname === item.to
            : location.pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
                active ? "bg-primary text-primary-foreground" : "text-muted-foreground",
              )}
            >
              <item.icon className="size-3.5" />
              {item.label}
            </Link>
          );
        })}
      </div>

      <main className="min-w-0 flex-1 px-4 py-6 pt-16 md:pt-6">
        <Outlet />
      </main>
    </div>
  );
}
