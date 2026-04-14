import { signIn } from "@/auth";

interface LoginPageProps {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error, callbackUrl } = await searchParams;
  const isAccessDenied = error === "AccessDenied";

  return (
    <div className="flex flex-col items-center justify-center h-dvh bg-app-bg px-8">
      <div className="w-full max-w-xs">
        {/* Logo */}
        <div className="flex flex-col items-center mb-10">
          <div className="w-16 h-16 rounded-2xl bg-gold/10 border border-gold/30 flex items-center justify-center mb-5">
            <span className="text-gold text-2xl font-bold">H</span>
          </div>
          <h1 className="text-white text-xl font-semibold">HonorBase Operator</h1>
          <p className="text-gray-500 text-sm mt-1">AI operations for mission-driven orgs</p>
        </div>

        {/* Access denied message */}
        {isAccessDenied && (
          <div className="mb-6 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-center">
            <p className="text-red-400 text-sm font-medium">Access not granted</p>
            <p className="text-gray-400 text-xs mt-1">
              Your Google account isn&apos;t on the access list.{" "}
              <a href="mailto:hello@honorbase.app" className="text-gold underline">
                Contact your administrator.
              </a>
            </p>
          </div>
        )}

        {/* Sign in form */}
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: callbackUrl ?? "/" });
          }}
        >
          <button
            type="submit"
            className="w-full flex items-center justify-center gap-3 px-4 py-3.5 rounded-2xl bg-white hover:bg-gray-100 transition-colors text-gray-900 text-sm font-medium"
          >
            {/* Google "G" logo */}
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path
                d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
                fill="#4285F4"
              />
              <path
                d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
                fill="#34A853"
              />
              <path
                d="M3.964 10.707A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z"
                fill="#FBBC05"
              />
              <path
                d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z"
                fill="#EA4335"
              />
            </svg>
            Sign in with Google
          </button>
        </form>

        <p className="text-center text-[10px] text-gray-600 mt-8">Powered by HonorBase</p>
      </div>
    </div>
  );
}
