/**
 * The pieces every setup step is drawn with: a value to copy, a link that
 * opens the Console in a new tab, what the person will see there, a check
 * that passed or failed, and the step's frame.
 */
import { useState, type ReactNode } from "react";
import {
  ArrowSquareOutIcon,
  CheckCircleIcon,
  CheckIcon,
  CopyIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { cn, IconButton, toast } from "@kb/ui-sdk";

/**
 * A value to paste somewhere else, shown whole, with a button that copies it:
 * one line, or a text of several lines kept as written and scrolled when long.
 */
export function CopyValue({ label, value }: { readonly label: string; readonly value: string }) {
  const text = value.includes("\n");
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast(`${label} copied`);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast(`Couldn't copy: select the ${label.toLowerCase()} and copy it by hand`);
    }
  };
  return (
    <div
      className={cn(
        "flex min-w-0 gap-1 rounded-md border border-border bg-muted py-0.5 pl-2 pr-0.5",
        text ? "items-start" : "items-center",
      )}
    >
      <code
        className={cn(
          "min-w-0 flex-1 font-mono text-meta text-foreground select-all",
          text ? "max-h-48 overflow-y-auto whitespace-pre-wrap break-words py-1" : "break-all",
        )}
        data-copy-value=""
      >
        {value}
      </code>
      <IconButton
        label={`Copy ${label}`}
        icon={copied ? CheckIcon : CopyIcon}
        onClick={() => void copy()}
      />
    </div>
  );
}

/** A link that opens a page in the Console (or another Google page) in a new tab. */
export function ConsoleLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-8 w-fit items-center gap-1.5 rounded-md border border-border bg-background px-3 text-ui text-foreground hover:bg-accent"
    >
      {children}
      <ArrowSquareOutIcon size={14} className="text-muted-foreground" aria-hidden />
    </a>
  );
}

/** What the person will see once there, step by step. */
export function WhatYouSee({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-label text-muted-foreground">What you'll see</h3>
      <ol className="flex list-decimal flex-col gap-1 pl-5 text-ui text-foreground marker:text-muted-foreground">
        {children}
      </ol>
    </div>
  );
}

/** A check's answer: what passed, or what failed and what to do. */
export function Verdict({
  tone,
  children,
}: {
  readonly tone: "ok" | "error" | "note";
  readonly children: ReactNode;
}) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-1.5 rounded-md px-2 py-1.5 text-meta",
        tone === "ok" && "bg-success/10 text-foreground",
        tone === "error" && "bg-destructive/10 text-foreground",
        tone === "note" && "bg-muted text-muted-foreground",
      )}
    >
      {tone === "ok" ? (
        <CheckCircleIcon size={14} weight="fill" className="mt-px shrink-0 text-success" />
      ) : null}
      {tone === "error" ? (
        <WarningCircleIcon size={14} weight="fill" className="mt-px shrink-0 text-destructive" />
      ) : null}
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** One step's panel: its number and title, why it is needed, and its body. */
export function StepFrame({
  index,
  title,
  why,
  children,
}: {
  readonly index: number;
  readonly title: string;
  readonly why: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4" aria-labelledby="setup-step-title" data-setup-panel="">
      <header className="flex flex-col gap-1">
        <span className="text-label text-muted-foreground">Step {index}</span>
        <h2 id="setup-step-title" className="text-heading text-foreground">
          {title}
        </h2>
        <p className="text-ui text-muted-foreground">{why}</p>
      </header>
      {children}
    </section>
  );
}

/** A labelled input. */
export function Field({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-label text-muted-foreground">{label}</span>
      {children}
      {hint === undefined ? null : <span className="text-meta text-muted-foreground">{hint}</span>}
    </label>
  );
}

/** Emphasis for a value the person picks or types in the Console. */
export function Pick({ children }: { readonly children: ReactNode }) {
  return <strong className="font-medium text-foreground">{children}</strong>;
}
