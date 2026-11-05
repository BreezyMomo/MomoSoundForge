import { createRoot } from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@momo/workbench/theme-tokens.css";
import App from "./App";
import { WorkbenchProvider } from "@momo/workbench/react";
import { appearance } from "./AppearancePreferences";
import { language, t } from "./i18n";
import "./style.css";
import "./workbench-controls.css";
createRoot(document.getElementById("root")!).render(
  <WorkbenchProvider
    appearance={appearance}
    language={language}
    ui={{ text: t, format: t, onLanguageChange: language.onLanguageChange }}
  >
    <App />
  </WorkbenchProvider>,
);

import "@momo/workbench/react.css";
import "@momo/workbench/tabs.css";
