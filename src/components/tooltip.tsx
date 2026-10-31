import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { KbdShortcut } from "./kbd";

export type TooltipSide = "top" | "bottom" | "left" | "right";

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: TooltipSide;
  delay?: number;
  disabled?: boolean;
  className?: string;
  wrapperClassName?: string;
}

export interface TooltipWithCommandProps {
  label: ReactNode;
  command: string | string[];
  children: ReactNode;
  side?: TooltipSide;
  delay?: number;
  disabled?: boolean;
  className?: string;
  wrapperClassName?: string;
}

interface TooltipCoordinates {
  top: number;
  left: number;
}

const VIEWPORT_PADDING = 8;
const SIDE_OFFSET = 6;

function computeCoordinates(
  triggerRect: DOMRect,
  tooltipRect: DOMRect,
  side: TooltipSide
): TooltipCoordinates {
  let top = 0;
  let left = 0;

  switch (side) {
    case "top":
      top = triggerRect.top - tooltipRect.height - SIDE_OFFSET;
      left = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2;
      break;
    case "bottom":
      top = triggerRect.bottom + SIDE_OFFSET;
      left = triggerRect.left + (triggerRect.width - tooltipRect.width) / 2;
      break;
    case "left":
      top = triggerRect.top + (triggerRect.height - tooltipRect.height) / 2;
      left = triggerRect.left - tooltipRect.width - SIDE_OFFSET;
      break;
    case "right":
      top = triggerRect.top + (triggerRect.height - tooltipRect.height) / 2;
      left = triggerRect.right + SIDE_OFFSET;
      break;
  }

  const maxLeft = Math.max(
    VIEWPORT_PADDING,
    window.innerWidth - tooltipRect.width - VIEWPORT_PADDING
  );
  const maxTop = Math.max(
    VIEWPORT_PADDING,
    window.innerHeight - tooltipRect.height - VIEWPORT_PADDING
  );

  return {
    left: Math.min(Math.max(VIEWPORT_PADDING, left), maxLeft),
    top: Math.min(Math.max(VIEWPORT_PADDING, top), maxTop),
  };
}

function getInitialOffset(side: TooltipSide): { x: number; y: number } {
  switch (side) {
    case "top":
      return { x: 0, y: 3 };
    case "bottom":
      return { x: 0, y: -3 };
    case "left":
      return { x: 3, y: 0 };
    case "right":
      return { x: -3, y: 0 };
  }
}

export function Tooltip({
  content,
  children,
  side = "bottom",
  delay = 350,
  disabled = false,
  className = "",
  wrapperClassName = "",
}: TooltipProps) {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState<TooltipCoordinates>({ top: 0, left: 0 });

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current || !tooltipRef.current) {
      return;
    }
    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    setCoords(computeCoordinates(triggerRect, tooltipRect, side));
  }, [side]);

  const showTooltip = useCallback(() => {
    if (disabled) {
      return;
    }
    clearTimer();
    timerRef.current = setTimeout(() => {
      setIsOpen(true);
    }, delay);
  }, [clearTimer, delay, disabled]);

  const hideTooltip = useCallback(() => {
    clearTimer();
    setIsOpen(false);
  }, [clearTimer]);

  useEffect(() => {
    if (disabled && isOpen) {
      setIsOpen(false);
    }
  }, [disabled, isOpen]);

  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, [clearTimer]);

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }
    updatePosition();

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen, content, updatePosition]);

  const initialOffset = getInitialOffset(side);

  return (
    <span
      ref={triggerRef}
      aria-describedby={isOpen ? tooltipId : undefined}
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onMouseDown={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
      className={`inline-flex items-center justify-center ${wrapperClassName}`.trim()}
    >
      {children}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {isOpen && !disabled && (
              <motion.div
                ref={tooltipRef}
                id={tooltipId}
                role="tooltip"
                initial={{ opacity: 0, x: initialOffset.x, y: initialOffset.y, scale: 0.97 }}
                animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: initialOffset.x, y: initialOffset.y, scale: 0.97 }}
                transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
                style={{ top: coords.top, left: coords.left }}
                className={`fixed z-50 pointer-events-none px-2.5 py-1 text-xs font-medium text-text-primary bg-elevated-surface border border-border rounded-md shadow-lg whitespace-nowrap select-none ${className}`.trim()}
              >
                {content}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </span>
  );
}

export function TooltipWithCommand({
  label,
  command,
  children,
  side = "bottom",
  delay = 350,
  disabled = false,
  className = "",
  wrapperClassName = "",
}: TooltipWithCommandProps) {
  return (
    <Tooltip
      side={side}
      delay={delay}
      disabled={disabled}
      className={className}
      wrapperClassName={wrapperClassName}
      content={
        <span className="inline-flex items-center gap-2">
          <span>{label}</span>
          <KbdShortcut command={command} />
        </span>
      }
    >
      {children}
    </Tooltip>
  );
}

export default Tooltip;
