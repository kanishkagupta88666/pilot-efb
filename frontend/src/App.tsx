import { BrowserRouter, Route, Routes } from "react-router-dom";
import { DocumentLibrary } from "./components/DocumentLibrary";
import { NotFound } from "./components/NotFound";
import { ComparePage } from "./components/ComparePage";
import { OpenNodeRoute } from "./components/OpenNodeRoute";
import { Reader } from "./components/Reader";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<DocumentLibrary />} />
      <Route path="/open" element={<OpenNodeRoute />} />
      <Route path="/compare/:docId" element={<ComparePage />} />
      <Route path="/reader/:docId/:revision" element={<Reader />} />
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
