import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { api } from "../convex/_generated/api";
import App from "./App";
import { ToastProvider } from "./components/ui";
import "./index.css";

const url = import.meta.env.VITE_CONVEX_URL as string | undefined;

function MissingConfig() {
  return (
    <div className="mx-auto mt-24 max-w-lg card p-8">
      <h1 className="h1">Almost there</h1>
      <p className="mt-3 text-sm text-muted">
        This app is not linked to a Convex backend yet. Run <code className="rounded bg-canvas px-1">npx convex dev</code> in
        the project folder. It signs you in and writes the backend address to <code className="rounded bg-canvas px-1">.env.local</code>.
      </p>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
if (!url) {
  root.render(<MissingConfig />);
} else {
  const convex = new ConvexReactClient(url);
  root.render(
    <StrictMode>
      <ConvexAuthProvider
        client={convex}
        api={{ refreshSession: api.auth.refreshSession, signOut: api.auth.signOut, isAuthenticated: api.auth.isAuthenticated }}
      >
        <BrowserRouter>
          <ToastProvider>
            <App />
          </ToastProvider>
        </BrowserRouter>
      </ConvexAuthProvider>
    </StrictMode>,
  );
}
