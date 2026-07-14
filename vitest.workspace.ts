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
       include: ['**/*.test.ts', '**/*.spec.ts'],
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
