import type { HTMLAttributes, ReactNode } from "react";

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
}

export function Kbd({ children, className = "", ...props }: KbdProps) {
  return (
    <kbd
      className={`inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-mono font-medium leading-none text-text-secondary bg-surface border border-border rounded-sm select-none ${className}`.trim()}
      {...props}
    >
      {children}
    </kbd>
  );
}

export interface KbdShortcutProps {
  command: string | string[];
  className?: string;
}

export function KbdShortcut({ command, className = "" }: KbdShortcutProps) {
  const keys = Array.isArray(command)
    ? command
    : command
        .split("+")
        .map((key) => key.trim())
        .filter(Boolean);

  return (
    <span className={`inline-flex items-center gap-1 ${className}`.trim()}>
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </span>
  );
}
