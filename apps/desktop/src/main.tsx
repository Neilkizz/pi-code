import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { App } from "./App";
import { QuickEntry } from "./features/quick-entry/QuickEntry";
import { I18nProvider } from "./i18n/I18nProvider";
import "./design-system/tokens.css";
import "./styles.css";

const isQuickEntry = getCurrentWindow().label === "quick-entry";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <I18nProvider>{isQuickEntry ? <QuickEntry /> : <App />}</I18nProvider>,
);
