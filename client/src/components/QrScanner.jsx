import { useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';

const ELEMENT_ID = 'qr-reader';

// Finishes when the previous scanner has fully stopped. A new scanner waits for
// it, so two scanners never fight over the camera (React's StrictMode mounts
// components twice in development, which would otherwise do exactly that).
let previousStop = Promise.resolve();

// Opens the back camera and calls onScan(text) for the first QR code it sees.
// The camera is turned off when this component unmounts.
export default function QrScanner({ onScan, onError }) {
  // Keep the latest callbacks in refs so the camera isn't restarted on every render.
  const onScanRef = useRef(onScan);
  const onErrorRef = useRef(onError);
  onScanRef.current = onScan;
  onErrorRef.current = onError;

  useEffect(() => {
    const scanner = new Html5Qrcode(ELEMENT_ID);
    let done = false;
    let cancelled = false;

    const started = previousStop.then(() => {
      if (cancelled) throw new Error('cancelled'); // unmounted before we began
      return scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: 220 },
        (text) => {
          if (done) return; // the camera may report the same code several times
          done = true;
          onScanRef.current(text);
        },
        () => {} // "no QR code in this frame" – ignore, it fires constantly
      );
    });

    started.catch((err) => {
      if (!cancelled) onErrorRef.current(err);
    });

    return () => {
      cancelled = true;
      // Wait for start() to finish before stopping, or html5-qrcode throws.
      previousStop = started
        .then(() => scanner.stop())
        .then(() => scanner.clear())
        .catch(() => {});
    };
  }, []);

  return <div id={ELEMENT_ID} className="qr-reader" />;
}
