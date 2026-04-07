import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/opc': {
        target: 'https://ocean.weather.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/opc/, '')
      }
    }
  }
});
