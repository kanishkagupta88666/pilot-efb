import { BrowserRouter, Route, Routes } from "react-router-dom";
import { DocumentLibrary } from "./components/DocumentLibrary";
import { Reader } from "./components/Reader";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<DocumentLibrary />} />
      <Route path="/reader/:docId/:revision" element={<Reader />} />
      <Route path="*" element={<DocumentLibrary />} />
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
