import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={clsx(
        "rounded-[var(--radius-card)] border border-line bg-card shadow-[var(--shadow-card)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
      <div>
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost";

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: "sm" | "md" | "lg" }) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" && "h-8 px-3 text-[13px]",
        size === "md" && "h-10 px-4 text-sm",
        size === "lg" && "h-12 px-5 text-[15px]",
        variant === "primary" && "bg-brand-orange text-white hover:bg-brand-orange-dark",
        variant === "secondary" && "border border-line bg-white text-ink-2 hover:bg-page",
        variant === "ghost" && "text-ink-2 hover:bg-page",
        className,
      )}
      {...props}
    />
  );
}

export type Tone = "orange" | "blue" | "green" | "amber" | "red" | "grey";

const toneClass: Record<Tone, string> = {
  orange: "bg-brand-orange-soft text-brand-orange-dark",
  blue: "bg-brand-blue-soft text-brand-blue",
  green: "bg-brand-green-soft text-[#0e6e05]",
  amber: "bg-brand-amber-soft text-[#b54708]",
  red: "bg-flag-red-soft text-flag-red",
  grey: "bg-page text-ink-2 border border-line",
};

const dotClass: Record<Tone, string> = {
  orange: "bg-brand-orange",
  blue: "bg-brand-blue",
  green: "bg-brand-green",
  amber: "bg-brand-amber",
  red: "bg-flag-red",
  grey: "bg-faint",
};

export function Badge({
  tone = "grey",
  dot = false,
  children,
  className,
}: {
  tone?: Tone;
  dot?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
        toneClass[tone],
        className,
      )}
    >
      {dot ? <span className={clsx("size-1.5 rounded-full", dotClass[tone])} /> : null}
      {children}
    </span>
  );
}

export function DemoBadge() {
  return (
    <Badge tone="amber" className="uppercase tracking-wide">
      Demo
    </Badge>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  "h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink placeholder:text-faint focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/15";
