import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { Location } from "react-router-dom";

import { AuthProvider } from "./auth/AuthContext";
import { HomePage } from "./pages/HomePage";

const JoinPage = lazy(async () => ({ default: (await import("./pages/JoinPage")).JoinPage }));
const GamesPage = lazy(async () => ({ default: (await import("./pages/GamesPage")).GamesPage }));
const GameDetailPage = lazy(async () => ({ default: (await import("./pages/GameDetailPage")).GameDetailPage }));
const CreatePage = lazy(async () => ({ default: (await import("./pages/CreatePage")).CreatePage }));
const SavesPage = lazy(async () => ({ default: (await import("./pages/SavesPage")).SavesPage }));
const LoginPage = lazy(async () => ({ default: (await import("./pages/LoginPage")).LoginPage }));

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
    <Suspense fallback={<RouteLoading />}>
      <Routes location={loginOpen ? backgroundLocation ?? "/" : location}>
        <Route path="/" element={<HomePage />} />
        <Route path="/join/:code" element={<JoinPage />} />
        <Route path="/games" element={<GamesPage />} />
        <Route path="/games/:slug" element={<GameDetailPage />} />
        <Route path="/create" element={<CreatePage />} />
        <Route path="/saves" element={<SavesPage />} />
        <Route
          path="/edit"
          element={
            <Suspense fallback={<div className="table-loading">Checking editor support…</div>}>
              <EditorRoute />
            </Suspense>
          }
        />
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
    </Suspense>
  );
}

export function App() {
  return <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}><AuthProvider><AppRoutes /></AuthProvider></BrowserRouter>;
}

function RouteLoading() {
  return <div className="route-loading" role="status"><span aria-hidden="true" />Loading Digipology…</div>;
}
