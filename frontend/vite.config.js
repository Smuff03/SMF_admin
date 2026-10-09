import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
  
  return {
    envDir: '..',
    plugins: [react()],
    server: { port: 5173 },
  };
});
