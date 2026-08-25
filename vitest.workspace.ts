import { defineWorkspace } from 'vitest/config';
import path from 'path';

 export default defineWorkspace([
   {
     test: {
       name: 'node',
       globals: true,
       environment: 'node',
       testTimeout: 30_000,
       hookTimeout: 15_000,
      include: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts'],
      // Playwright-authored browser specs must not be collected by Vitest.
      exclude: ['tests/verify-okx-leader.test.ts', '**/node_modules/**', '**/dist/**', '**/cypress/**', '**/.{idea,git,cache,output,temp}/**'],
     },
     resolve: {
       alias: {
         '@': path.resolve(__dirname, 'src'),
       },
       conditions: ['node'],
       mainFields: ['module', 'main'],
     },
   },
 ]);
