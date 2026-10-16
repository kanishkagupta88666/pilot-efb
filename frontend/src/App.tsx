import { useEffect } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AnnotationProvider } from "./annotations/annotations";
import { DocumentLibrary } from "./components/DocumentLibrary";
import { NotFound } from "./components/NotFound";
import { AuthorPage } from "./components/AuthorPage";
import { ComparePage } from "./components/ComparePage";
import { OpenNodeRoute } from "./components/OpenNodeRoute";
import { Reader } from "./components/Reader";
import { SearchPage } from "./components/SearchPage";
import { AuditPage } from "./components/AuditPage";
import { SignInPage } from "./components/SignInPage";
import { startAuditSync } from "./utils/auditLog";

export function AppRoutes() {
  return (
    <AnnotationProvider>
      <Routes>
        <Route path="/" element={<DocumentLibrary />} />
        <Route path="/open" element={<OpenNodeRoute />} />
        <Route path="/compare/:docId" element={<ComparePage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/author/:docId" element={<AuthorPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/reader/:docId/:revision" element={<Reader />} />
        <Route path="/sign-in" element={<SignInPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AnnotationProvider>
  );
}

function App() {
  useEffect(() => startAuditSync(), []);
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;
