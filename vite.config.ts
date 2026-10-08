import { defineConfig } from 'vite';
export default defineConfig({root:'ui',build:{outDir:'../dist/ui',emptyOutDir:true},server:{host:'127.0.0.1',port:4301,proxy:{'/api':'http://127.0.0.1:4300'}}});
