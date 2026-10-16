import { BrowserRouter, Route, Routes } from "react-router-dom";
import { DocumentLibrary } from "./components/DocumentLibrary";
import { NotFound } from "./components/NotFound";
import { OpenNodeRoute } from "./components/OpenNodeRoute";
import { Reader } from "./components/Reader";
import { SignInPage } from "./components/SignInPage";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<DocumentLibrary />} />
      <Route path="/open" element={<OpenNodeRoute />} />
      <Route path="/reader/:docId/:revision" element={<Reader />} />
      <Route path="/sign-in" element={<SignInPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;
