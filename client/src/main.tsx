import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { captureRef } from "./lib/referral";
import { installErrorReporting } from "./lib/errorReport";
import { installUpdateCheck } from "./lib/update";
import { installViewportFix } from "./lib/viewportFix";

captureRef();
installErrorReporting();
installUpdateCheck();
installViewportFix();

if (!window.location.hash) {
  window.location.hash = "#/";
}

createRoot(document.getElementById("root")!).render(<App />);
