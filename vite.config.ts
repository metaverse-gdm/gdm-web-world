import { defineConfig, loadEnv } from 'vite'
import preact from '@preact/preset-vite'
import { fileURLToPath } from 'node:url'

// GitHub main does not yet export the scope vault from the supplied reference.
const vaultSource = (file: string) => fileURLToPath(new URL(`./vendor/mistvault/src/${file}`, import.meta.url))

export default defineConfig(({ mode }) => ({
  base: loadEnv(mode, process.cwd()).VITE_BASE_PATH || '/worlds/',
  plugins: [preact()],
  optimizeDeps: { exclude: ['@tik-choco/mistlib', '@tik-choco/mistlib-web'] },
  resolve: { alias: [
    { find: /^@tik-choco\/mistvault$/, replacement: vaultSource('index.ts') },
    { find: /^@tik-choco\/mistvault\/preact$/, replacement: vaultSource('preact/index.ts') },
    { find: /^@tik-choco\/mistvault\/ui\.css$/, replacement: vaultSource('preact/ui.css') },
  ] },
}))
