import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { Location } from "react-router-dom";

import { AuthProvider } from "./auth/AuthContext";
import { CreatePage } from "./pages/CreatePage";
import { GamesPage } from "./pages/GamesPage";
import { GameDetailPage } from "./pages/GameDetailPage";
import { HomePage } from "./pages/HomePage";
import { JoinPage } from "./pages/JoinPage";
import { LoginPage } from "./pages/LoginPage";

const TablePage = lazy(async () => {
  const module = await import("./pages/TablePage");
  return { default: module.TablePage };
});

const EditorRoute = lazy(async () => {
  const module = await import("./pages/EditorRoute");
  return { default: module.EditorRoute };
});

export function AppRoutes() {
  const location = useLocation();
  const state = location.state as { backgroundLocation?: Location } | null;
  const backgroundLocation = state?.backgroundLocation;
  const loginOpen = location.pathname === "/login";
  return (
    <>
      <Routes location={loginOpen ? backgroundLocation ?? "/" : location}>
        <Route path="/" element={<HomePage />} />
        <Route path="/join/:code" element={<JoinPage />} />
        <Route path="/games" element={<GamesPage />} />
        <Route path="/games/:slug" element={<GameDetailPage />} />
        <Route path="/create" element={<CreatePage />} />
        <Route
          path="/edit/:draftId"
          element={
            <Suspense fallback={<div className="table-loading">Checking editor support…</div>}>
              <EditorRoute />
            </Suspense>
          }
        />
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
      {loginOpen ? <LoginPage restoreHistory={backgroundLocation !== undefined} /> : null}
    </>
  );
}

export function App() {
  return <BrowserRouter><AuthProvider><AppRoutes /></AuthProvider></BrowserRouter>;
}
