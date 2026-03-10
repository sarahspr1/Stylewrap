import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import OutfitApp from "./OutfitApp.jsx";

// This is the starting point of the app.
// It takes the <div id="root"> in index.html and fills it with your OutfitApp.
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <OutfitApp />
  </StrictMode>
);
