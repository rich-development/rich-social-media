import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ClerkProvider, useAuth } from "@clerk/react";
import App from "./App";
import { ToastProvider } from "./components/ui";
import "./index.css";

const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

function MissingConfig() {
  return (
    <div className="mx-auto mt-24 max-w-lg card p-8">
      <h1 className="h1">Almost there</h1>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted">
        {!url && <li>No Convex backend linked. Run <code className="rounded bg-canvas px-1">npx convex dev</code> in the project folder.</li>}
        {!clerkKey && <li>No Clerk key. Add <code className="rounded bg-canvas px-1">VITE_CLERK_PUBLISHABLE_KEY</code> to <code className="rounded bg-canvas px-1">.env.local</code>, then restart.</li>}
      </ul>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
if (!url || !clerkKey) {
  root.render(<MissingConfig />);
} else {
  const convex = new ConvexReactClient(url);
  root.render(
    <StrictMode>
      <ClerkProvider publishableKey={clerkKey} afterSignOutUrl="/">
        <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
          <BrowserRouter>
            <ToastProvider>
              <App />
            </ToastProvider>
          </BrowserRouter>
        </ConvexProviderWithClerk>
      </ClerkProvider>
    </StrictMode>,
  );
}
