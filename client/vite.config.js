import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev`        -> http://localhost:5173 (this laptop only)
// `npm run dev:https`  -> https://<laptop-ip>:5173 for a phone on the same Wi-Fi.
// Browsers only allow the microphone and camera on HTTPS or localhost, so the
// phone needs HTTPS. basicSsl makes a self-signed certificate (the phone will
// show a warning once; that's expected for a local prototype).
export default defineConfig(({ mode }) => {
  const https = mode === 'https';

  return {
    plugins: [react(), https && basicSsl()].filter(Boolean),
    server: {
      port: 5173,
      host: https, // true = listen on the local network, not just localhost
      // Allow tunnel hostnames (cloudflared / ngrok), the other two-device option.
      allowedHosts: ['.trycloudflare.com', '.ngrok-free.app'],
      // Forward /api/* to Express. The browser only ever talks to Vite,
      // so there is one origin and no CORS setup is needed.
      proxy: {
        '/api': 'http://localhost:4000',
      },
    },
  };
});
