import { useEffect, useRef } from "react";

export interface KeybindDefinition {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  preventDefault?: boolean;
  handler: (event: KeyboardEvent) => void;
}

export function useKeybinds(keybinds: KeybindDefinition[], enabled = true) {
  const keybindsRef = useRef(keybinds);

  useEffect(() => {
    keybindsRef.current = keybinds;
  }, [keybinds]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const eventKey = event.key.toLowerCase();
      const isCtrlOrMeta = event.ctrlKey || event.metaKey;

      for (const bind of keybindsRef.current) {
        const keyMatches = eventKey === bind.key.toLowerCase();
        const ctrlMatches = Boolean(bind.ctrl) === isCtrlOrMeta;
        const shiftMatches = Boolean(bind.shift) === event.shiftKey;
        const altMatches = Boolean(bind.alt) === event.altKey;

        if (keyMatches && ctrlMatches && shiftMatches && altMatches) {
          if (bind.preventDefault !== false) {
            event.preventDefault();
          }
          bind.handler(event);
          break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [enabled]);
}
