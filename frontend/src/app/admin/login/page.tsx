"use client";

import * as React from "react";
import Script from "next/script";
import { useRouter } from "next/navigation";
import { Clock3, Leaf, ShieldX } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  devLogin,
  getAuthProviders,
  getMe,
  loginWithGoogle,
  logout,
  type AuthProviders,
} from "@/lib/api";
import type { UserStatus } from "@/lib/team";

type GoogleCredentialResponse = { credential: string };

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: GoogleCredentialResponse) => void;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: Record<string, unknown>
          ) => void;
        };
      };
    };
  }
}

type Screen = "checking" | "signin" | "pending" | "suspended";

export default function AdminLoginPage() {
  const router = useRouter();
  const [screen, setScreen] = React.useState<Screen>("checking");
  const [error, setError] = React.useState<string | null>(null);
  const [gisReady, setGisReady] = React.useState(false);
  // Which sign-in methods exist and the Google client id, read from the API
  // at runtime so a deployment never needs a rebuild to change them.
  const [providers, setProviders] = React.useState<AuthProviders | null>(null);
  const buttonRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    getAuthProviders().then(setProviders);
  }, []);

  const routeByStatus = React.useCallback(
    (status: UserStatus) => {
      if (status === "active") {
        router.replace("/admin");
      } else {
        setScreen(status === "pending" ? "pending" : "suspended");
      }
    },
    [router]
  );

  React.useEffect(() => {
    getMe()
      .then((me) => (me ? routeByStatus(me.status) : setScreen("signin")))
      .catch(() => setScreen("signin"));
  }, [routeByStatus]);

  const googleClientId = providers?.googleClientId ?? "";

  React.useEffect(() => {
    if (screen !== "signin" || !gisReady || !buttonRef.current) return;
    if (!window.google || !googleClientId) return;

    window.google.accounts.id.initialize({
      client_id: googleClientId,
      callback: async (response) => {
        try {
          const user = await loginWithGoogle(response.credential);
          routeByStatus(user.status);
        } catch {
          setError("সাইন ইন ব্যর্থ হয়েছে। আবার চেষ্টা করুন।");
        }
      },
    });
    window.google.accounts.id.renderButton(buttonRef.current, {
      theme: "outline",
      size: "large",
      width: 280,
    });
  }, [screen, gisReady, routeByStatus, googleClientId]);

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      {googleClientId && (
        <Script
          src="https://accounts.google.com/gsi/client"
          onLoad={() => setGisReady(true)}
        />
      )}
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Leaf className="size-6" />
          </div>
          <CardTitle>Nature Bazar Admin</CardTitle>
          <CardDescription>
            {screen === "signin" &&
              (providers?.google
                ? "Sign in with your Google account"
                : providers?.dev
                  ? "Local development sign-in"
                  : "Sign in")}
            {screen === "checking" && "Checking your session…"}
            {screen === "pending" && "Waiting for approval"}
            {screen === "suspended" && "Account suspended"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          {screen === "signin" && (
            <>
              {providers !== null && !providers.google && !providers.dev && (
                <p className="text-center text-sm text-destructive">
                  No sign-in method is configured on the server
                  (GOOGLE_CLIENT_ID is empty).
                </p>
              )}
              <div ref={buttonRef} />
              {providers?.dev && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={async () => {
                    try {
                      const user = await devLogin();
                      routeByStatus(user.status);
                    } catch {
                      setError("Dev sign-in failed.");
                    }
                  }}
                >
                  Dev sign-in (local only)
                </Button>
              )}
              {error && (
                <p className="text-center text-sm text-destructive">{error}</p>
              )}
            </>
          )}

          {screen === "pending" && (
            <>
              <Clock3 className="size-8 text-amber-500" />
              <p className="text-center text-sm text-muted-foreground">
                আপনার অ্যাকাউন্টটি তৈরি হয়েছে। সুপার অ্যাডমিন অনুমোদন করলেই
                আপনি ঢুকতে পারবেন।
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  await logout();
                  setScreen("signin");
                }}
              >
                Sign in with a different account
              </Button>
            </>
          )}

          {screen === "suspended" && (
            <>
              <ShieldX className="size-8 text-destructive" />
              <p className="text-center text-sm text-muted-foreground">
                আপনার অ্যাক্সেস স্থগিত করা হয়েছে। সুপার অ্যাডমিনের সাথে যোগাযোগ
                করুন।
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  await logout();
                  setScreen("signin");
                }}
              >
                Sign in with a different account
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
