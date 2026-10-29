import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { captureRef, captureFboRef, captureSrc } from "./lib/referral";
import { trackArrival } from "./lib/metrics";
import { installErrorReporting } from "./lib/errorReport";
import { installUpdateCheck } from "./lib/update";
import { installViewportFix } from "./lib/viewportFix";

const arrivedVia = captureSrc(); // before captureRef, which rewrites the URL
captureRef();
captureFboRef();
if (arrivedVia) trackArrival(arrivedVia);
installErrorReporting();
installUpdateCheck();
installViewportFix();

if (!window.location.hash) {
  window.location.hash = "#/";
}

createRoot(document.getElementById("root")!).render(<App />);
