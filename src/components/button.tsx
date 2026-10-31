import type { ButtonHTMLAttributes, Ref } from "react";
import { Tooltip, TooltipWithCommand, type TooltipSide } from "./tooltip";

export type ButtonVariant =
  | "ghost"
  | "primary"
  | "secondary"
  | "danger"
  | "window-control"
  | "window-close";

export type ButtonSize = "icon-sm" | "icon" | "sm" | "md" | "window";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  ref?: Ref<HTMLButtonElement>;
  variant?: ButtonVariant;
  size?: ButtonSize;
  tooltip?: string;
  command?: string | string[];
  tooltipSide?: TooltipSide;
  tooltipDelay?: number;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  ghost:
    "text-text-secondary hover:text-text-primary hover:bg-ghost-hover active:bg-elevated-surface cursor-pointer",
  primary:
    "bg-accent text-accent-foreground hover:bg-accent-hover active:bg-accent-active cursor-pointer",
  secondary:
    "bg-surface text-text-primary border border-border hover:bg-elevated-surface active:bg-background cursor-pointer",
  danger:
    "bg-danger text-white hover:bg-danger/90 active:bg-danger/80 cursor-pointer",
  "window-control":
    "text-text-secondary hover:text-text-primary hover:bg-ghost-hover active:bg-selection",
  "window-close":
    "text-text-secondary hover:text-white hover:bg-danger active:bg-danger/80",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  "icon-sm": "w-7 h-7 rounded-md",
  icon: "w-8 h-8 rounded-md",
  sm: "h-7 px-2.5 text-xs font-medium rounded-md gap-1.5",
  md: "h-8 px-3 text-sm font-medium rounded-md gap-2",
  window: "w-9 h-full",
};

export function Button({
  ref,
  type = "button",
  variant = "ghost",
  size = "md",
  tooltip,
  command,
  tooltipSide = "bottom",
  tooltipDelay,
  disabled,
  className = "",
  children,
  ...props
}: ButtonProps) {
  const buttonElement = (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      aria-label={props["aria-label"] ?? tooltip}
      className={`inline-flex items-center justify-center shrink-0 select-none transition-colors outline-none focus-visible:ring-1 focus-visible:ring-border-focused disabled:opacity-50 disabled:pointer-events-none ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );

  if (!tooltip) {
    return buttonElement;
  }

  const wrapperClassName = size === "window" ? "h-full" : "";

  if (command !== undefined) {
    return (
      <TooltipWithCommand
        label={tooltip}
        command={command}
        side={tooltipSide}
        delay={tooltipDelay}
        disabled={disabled}
        wrapperClassName={wrapperClassName}
      >
        {buttonElement}
      </TooltipWithCommand>
    );
  }

  return (
    <Tooltip
      content={tooltip}
      side={tooltipSide}
      delay={tooltipDelay}
      disabled={disabled}
      wrapperClassName={wrapperClassName}
    >
      {buttonElement}
    </Tooltip>
  );
}

export default Button;
