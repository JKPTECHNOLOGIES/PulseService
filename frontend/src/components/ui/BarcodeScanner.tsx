import { useEffect, useRef, useState } from "react";
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
          onDetected(result.getText());
          onClose();
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
  }, [isOpen, onDetected, onClose]);

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
    </Modal>
  );
}
