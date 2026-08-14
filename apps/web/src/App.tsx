import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AuthProvider } from "./auth/AuthContext";
import { CreatePage } from "./pages/CreatePage";
import { GamesPage } from "./pages/GamesPage";
import { HomePage } from "./pages/HomePage";
import { JoinPage } from "./pages/JoinPage";
import { LoginPage } from "./pages/LoginPage";

const TablePage = lazy(async () => {
  const module = await import("./pages/TablePage");
  return { default: module.TablePage };
});

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/join/:code" element={<JoinPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/games" element={<GamesPage />} />
      <Route path="/create" element={<CreatePage />} />
      <Route
        path="/table/:roomId"
        element={
          <Suspense fallback={<div className="table-loading">Preparing the table…</div>}>
            <TablePage />
          </Suspense>
        }
      />
      <Route path="*" element={<Navigate replace to="/" />} />
    </Routes>
  );
}

export function App() {
  return <BrowserRouter><AuthProvider><AppRoutes /></AuthProvider></BrowserRouter>;
}
