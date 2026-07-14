import React from "react";
import { createRoot } from "react-dom/client";
import "@vibe/core/tokens"; // CSS של @vibe/core - חייב להיות לפני ה-CSS שלנו
import "./index.css";
import "./init";
import "./i18n"; // אתחול i18next — חובה לפני שרכיבים שמשתמשים ב-useTranslation נטענים
import { setupGlobalErrorHandlers } from './utils/globalErrorHandler';
import { attachAxiomSink } from './utils/axiomSink';
import { bootDiag } from './utils/reloadDiag'; // ⚠️ TEMP diagnostic (#103) — להסיר אחרי איתור השורש
import { getVersionLabel } from './utils/versionLabel';
import App from "./App";

// Version layer (docs/monday-cicd-spec.md): one log line per boot, same label as the Settings footer.
console.info('[tracker] ' + getVersionLabel());

// ⚠️ TEMP diagnostic (#103): מדפיס היסטוריית reloadים לקונסול בכל boot. מוקדם ככל הניתן.
bootDiag();

// הגדרת global error handlers לפני טעינת האפליקציה
setupGlobalErrorHandlers();

// שילוח לוגים ל-Axiom: חיבור סינכרוני לפני render — חובה שיקרה כאן כדי שה-replay
// של ה-ring buffer והאזנה חיה לא יחפפו (ראו ../TRACKER-AXIOM-EXECUTION-PLAN.md §4.4).
// בפיתוח/טאנל המודול אינרטי (אין token בקבצי הסביבה) — אפס רשת, אפס רעש.
attachAxiomSink();

const root = createRoot(document.getElementById("root"));
root.render(<App />);
