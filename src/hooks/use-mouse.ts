import { useEffect, useRef } from "react";
import { useStdin, useStdout } from "ink";

export type MouseEvent =
  | { kind: "down"; button: "left"; x: number; y: number }
  | { kind: "scroll"; direction: "up" | "down"; x: number; y: number };

const ENABLE_MOUSE = "\x1b[?1000h\x1b[?1006h";
const DISABLE_MOUSE = "\x1b[?1000l\x1b[?1006l";

// eslint-disable-next-line no-control-regex -- intentional terminal escape sequence matching
const SGR_RE = /\x1b\[<(\d+);(\d+);(\d+)([mM])/g;

function parseSgrEvent(
  code: number,
  x: number,
  y: number,
  isDown: boolean,
): MouseEvent | null {
  const isWheel = (code & 64) === 64;
  if (isWheel) {
    const direction = (code & 1) === 1 ? "down" : "up";
    return { kind: "scroll", direction, x, y };
  }

  if (!isDown) return null;
  const button = code & 3;
  if (button === 0) return { kind: "down", button: "left", x, y };
  return null;
}

export function useMouse(handler: (event: MouseEvent) => void) {
  const { stdout } = useStdout();
  const { internal_eventEmitter } = useStdin();
  const handlerRef = useRef(handler);
  const bufferRef = useRef("");

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    stdout.write(ENABLE_MOUSE);

    const onInput = (data: Buffer | string) => {
      const chunk = typeof data === "string" ? data : data.toString("utf8");
      bufferRef.current += chunk;

      let match: RegExpExecArray | null;
      let lastIndex = 0;
      SGR_RE.lastIndex = 0;
      while ((match = SGR_RE.exec(bufferRef.current)) !== null) {
        lastIndex = SGR_RE.lastIndex;
        const code = Number(match[1]);
        const x = Number(match[2]);
        const y = Number(match[3]);
        const isDown = match[4] === "M";
        const event = parseSgrEvent(code, x, y, isDown);
        if (event) handlerRef.current(event);
      }

      if (lastIndex > 0) {
        bufferRef.current = bufferRef.current.slice(lastIndex);
      } else {
        const prefixIndex = bufferRef.current.lastIndexOf("\x1b[<");
        if (prefixIndex === -1) bufferRef.current = "";
        else if (prefixIndex > 0)
          bufferRef.current = bufferRef.current.slice(prefixIndex);
      }
      if (bufferRef.current.length > 2000) {
        bufferRef.current = bufferRef.current.slice(-200);
      }
    };

    internal_eventEmitter.on("input", onInput);
    return () => {
      internal_eventEmitter.removeListener("input", onInput);
      stdout.write(DISABLE_MOUSE);
    };
  }, [stdout, internal_eventEmitter]);
}
