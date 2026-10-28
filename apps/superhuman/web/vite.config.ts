import { defineConfig } from 'vite';

function port(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${name} must be a valid port`);
  return value;
}

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: port('SUPERHUMAN_WEB_PORT', 5173),
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${port('SUPERHUMAN_API_PORT', 3001)}` },
  },
  preview: { port: 4173 },
});
