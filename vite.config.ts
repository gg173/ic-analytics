import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createBuildId, readPackageVersion } from './scripts/buildVersion'

const appVersion = readPackageVersion()
const appBuildId = createBuildId()

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
    'import.meta.env.VITE_APP_BUILD_ID': JSON.stringify(appBuildId),
  },
})
