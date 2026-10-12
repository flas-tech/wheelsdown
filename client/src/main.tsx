import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { captureRef } from "./lib/referral";
import { installErrorReporting } from "./lib/errorReport";

captureRef();
installErrorReporting();

if (!window.location.hash) {
  window.location.hash = "#/";
}

createRoot(document.getElementById("root")!).render(<App />);
