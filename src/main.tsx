import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Stylique CRM root element was not found.");
}

createRoot(root).render(<App />);
