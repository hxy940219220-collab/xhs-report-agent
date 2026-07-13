import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./AppV2";
import "./wizard.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
