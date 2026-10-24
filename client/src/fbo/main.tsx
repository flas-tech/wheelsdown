import { createRoot } from "react-dom/client";
import FboApp from "./App";
import "../index.css";

if (!window.location.hash) window.location.hash = "#/";
createRoot(document.getElementById("root")!).render(<FboApp />);
