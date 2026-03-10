import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// This file tells Vite (the tool that runs your app) how to behave.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,       // Your app will open at http://localhost:3000
    open: true,       // Automatically opens the browser when you run "npm run dev"
  },
});
