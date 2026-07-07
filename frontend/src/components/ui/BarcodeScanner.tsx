import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import Modal from "./Modal";

interface BarcodeScannerProps {
  isOpen: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
}

/**
 * Camera barcode/QR scanner (uses @zxing/browser). NOTE: camera access requires
 * a secure context — it works on localhost but on a phone over the network it
 * needs HTTPS. We surface a clear message if the camera can't be opened.
 */
export default function BarcodeScanner({
  isOpen,
  onClose,
  onDetected,
}: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [manual, setManual] = useState("");

  // Keep the latest callbacks in refs so the camera-init effect can depend only
  // on `isOpen`. Otherwise a parent re-render (new onDetected/onClose refs)
  // would tear down and restart the camera stream -- flicker and, on some
  // devices, a repeated permission prompt.
  const onDetectedRef: MutableRefObject<(code: string) => void> =
    useRef(onDetected);
  const onCloseRef: MutableRefObject<() => void> = useRef(onClose);
  useEffect(() => {
    onDetectedRef.current = onDetected;
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!isOpen) return;
    const video = videoRef.current;
    if (!video) return;

    const reader = new BrowserMultiFormatReader();
    let controls: { stop: () => void } | undefined;
    let done = false;

    reader
      .decodeFromVideoDevice(undefined, video, (result, _err, ctrl) => {
        controls = ctrl;
        if (result && !done) {
          done = true;
          ctrl.stop();
          onDetectedRef.current(result.getText());
          onCloseRef.current();
        }
      })
      .then((c) => {
        controls = c;
      })
      .catch(() => {
        setError(
          "Unable to access the camera. On a phone this requires HTTPS (it works on localhost).",
        );
      });

    return () => {
      done = true;
      controls?.stop();
    };
  }, [isOpen]);

  const submitManual = () => {
    const code = manual.trim();
    if (!code) return;
    onDetected(code);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Scan Barcode">
      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : (
        <>
          <video
            ref={videoRef}
            className="w-full rounded-lg bg-black aspect-video"
            muted
            playsInline
          />
          <p className="mt-2 text-center text-xs text-gray-500">
            Point the camera at a barcode or QR code.
          </p>
        </>
      )}

      {/* Manual entry: always available, so the lookup still works when the
          camera can't open (plain-HTTP LAN access, denied permission, no
          camera) or a label is too damaged to scan. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitManual();
        }}
        className="mt-4 border-t border-gray-100 pt-4"
      >
        <label className="block text-xs font-medium text-gray-500 mb-1.5">
          {error ? "Enter the code" : "…or enter it manually"}
        </label>
        <div className="flex items-center gap-2">
          <input
            value={manual}
            onChange={(e) => {
              setManual(e.target.value);
            }}
            placeholder="SKU or barcode"
            autoComplete="off"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
          />
          <button
            type="submit"
            disabled={!manual.trim()}
            className="shrink-0 inline-flex items-center justify-center min-h-[44px] px-4 rounded-lg text-sm font-medium bg-primary-600 text-oncolor hover:bg-primary-700 disabled:opacity-50"
          >
            Use
          </button>
        </div>
      </form>
    </Modal>
  );
}
