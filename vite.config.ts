import { defineConfig, type Plugin } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Dev-only: lets the page POST a rendered frame to disk (`window.__shot`), so an
 * agent can look at the scene without relying on browser screenshots.
 */
function frameGrabber(outDir: string): Plugin {
  return {
    name: 'frame-grabber',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const name = String(body.name || 'shot').replace(/[^\w./-]/g, '_').replace(/\.\.+/g, '_');
            const data = String(body.data || '').replace(/^data:image\/\w+;base64,/, '');
            const file = path.join(outDir, name.endsWith('.jpg') ? name : name + '.jpg');
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, Buffer.from(data, 'base64'));
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, file }));
          } catch (e) {
            res.statusCode = 500;
            res.end(String(e));
          }
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // `npm run dev:vr` serves HTTPS on the LAN, which WebXR on a headset requires.
  const vr = mode === 'vr';
  return {
    base: './',
    plugins: [frameGrabber(path.resolve(process.cwd(), '.shots')), ...(vr ? [basicSsl()] : [])],
    server: { port: 5180, host: vr ? true : '127.0.0.1', open: false },
    preview: { port: 5181, host: '127.0.0.1' },
    build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 1500 },
  };
});
