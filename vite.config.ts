import { defineConfig } from 'vite';

// 정적 배포(GitHub Pages 포함) 대비 상대 경로 베이스.
export default defineConfig({
  base: './',
  build: {
    target: 'es2021',
    outDir: 'dist',
  },
});
