import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

export interface SignaturePadHandle {
  clear: () => void;
  isEmpty: () => boolean;
  toBlob: () => Promise<Blob | null>;
}

interface SignaturePadProps {
  className?: string;
}

/**
 * A finger/stylus/mouse signature pad. Draws onto a canvas with a white
 * background so the exported PNG is a clean, flat image. `touch-none` prevents
 * the page from scrolling while signing on a touchscreen.
 */
const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(
  function SignaturePad({ className }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawing = useRef(false);
    const [dirty, setDirty] = useState(false);

    const paintBackground = (canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * ratio;
      canvas.height = rect.height * ratio;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(ratio, ratio);
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "#111827";
      }
      paintBackground(canvas);
    }, []);

    const relativePos = (canvas: HTMLCanvasElement, e: ReactPointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const handleDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      drawing.current = true;
      const p = relativePos(canvas, e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      canvas.setPointerCapture(e.pointerId);
    };

    const handleMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!drawing.current) return;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const p = relativePos(canvas, e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      if (!dirty) setDirty(true);
    };

    const handleUp = () => {
      drawing.current = false;
    };

    useImperativeHandle(
      ref,
      () => ({
        clear: () => {
          const canvas = canvasRef.current;
          if (canvas) paintBackground(canvas);
          setDirty(false);
        },
        isEmpty: () => !dirty,
        toBlob: () =>
          new Promise<Blob | null>((resolve) => {
            const canvas = canvasRef.current;
            if (!canvas) {
              resolve(null);
              return;
            }
            canvas.toBlob((b) => {
              resolve(b);
            }, "image/png");
          }),
      }),
      [dirty],
    );

    return (
      <canvas
        ref={canvasRef}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerLeave={handleUp}
        className={
          className ??
          "w-full h-48 rounded-lg border border-gray-300 bg-white touch-none"
        }
      />
    );
  },
);

export default SignaturePad;
