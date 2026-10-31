import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

// Shows `text` as a QR code image. Used as the fallback when sound fails.
export default function QrCode({ text }) {
  const [src, setSrc] = useState('');

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(text, { margin: 1, width: 220 }).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => {
      cancelled = true; // ignore the result if `text` changed meanwhile
    };
  }, [text]);

  return src ? <img className="qr" src={src} alt="Payment QR code" /> : null;
}
