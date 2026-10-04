import {
	isRouteErrorResponse,
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
	useLoaderData,
	useNavigation,
} from "react-router";
import { useEffect } from "react";

import type { Route } from "./+types/root";
import "./app.css";
import { getAuthenticatedUser } from "~/lib/auth.server";
import { getLanguageFromCookieHeader, I18nProvider, resolveLanguage } from "~/lib/i18n";
export async function loader({ request, context }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const cookieLang = getLanguageFromCookieHeader(request.headers.get("Cookie"));
	if (cookieLang) return { lang: cookieLang };

	try {
		const user = await getAuthenticatedUser(request, env.DB, env.SESSIONPORTAL);
		if (user?.language) return { lang: resolveLanguage(user.language) };
	} catch {
		// D1 / KV infrastructure error — degrade gracefully
	}

	return { lang: "th" as const };
}

export const links: Route.LinksFunction = () => [
	{ rel: "icon", href: "/favicon.ico" },
	{ rel: "preconnect", href: "https://fonts.googleapis.com" },
	{
		rel: "preconnect",
		href: "https://fonts.gstatic.com",
		crossOrigin: "anonymous",
	},
	{
		rel: "stylesheet",
		href: "https://fonts.googleapis.com/css2?family=Anuphan:wght@400;500;600;700&family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700&display=swap",
	},
];

export function Layout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<head>
				<meta charSet="utf-8" />
				<meta name="viewport" content="width=device-width, initial-scale=1" />
				<Meta />
				<Links />
			</head>
			<body>
				{children}
				<ScrollRestoration />
				<Scripts />
			</body>
		</html>
	);
}

export default function App() {
	const { lang } = useLoaderData<typeof loader>();
	const navigation = useNavigation();
	const isNavigating = navigation.state !== "idle";
	return (
		<I18nProvider initialLang={lang}>
			<div
				aria-hidden="true"
				className={`fixed top-0 left-0 z-[100] h-1 w-full bg-[#F0D800] transition-all duration-300 ${
					isNavigating ? "opacity-100" : "opacity-0"
				}`}
				style={{
					transformOrigin: "left",
					transform: isNavigating ? "scaleX(0.85)" : "scaleX(0)",
				}}
			/>
			<Outlet />
		</I18nProvider>
	);
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	let status = 500;
	let title = "เกิดข้อผิดพลาด";
	let detail = "เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง";
	let stack: string | undefined;
	const isInfraError = !isRouteErrorResponse(error);

	if (isRouteErrorResponse(error)) {
		status = error.status;
		if (error.status === 404) {
			title = "ไม่พบหน้านี้";
			detail = "ขออภัย ไม่พบหน้าที่คุณกำลังมองหา";
		} else if (error.status === 403) {
			title = "ไม่มีสิทธิ์เข้าถึง";
			detail = "คุณไม่มีสิทธิ์เข้าถึงหน้านี้";
		} else {
			detail = error.statusText || detail;
		}
	} else if (import.meta.env.DEV && error instanceof Error) {
		detail = error.message;
		stack = error.stack;
	}

	// For infra errors (D1 / KV failures), redirect home so the user can retry
	// eslint-disable-next-line react-hooks/rules-of-hooks
	useEffect(() => {
		if (isInfraError) {
			window.location.replace("/");
		}
	}, [isInfraError]);

	return (
		<main className="min-h-screen bg-paper flex items-center justify-center p-4">
			<div className="bg-white rounded-[24px] border border-line p-8 md:p-10 max-w-md w-full text-center space-y-3">
				<p className="inline-flex rounded-2xl bg-brand-yellow px-4 py-1 font-display text-5xl font-bold tracking-[-0.03em] tabular-nums text-ink">{status}</p>
				<h1 className="text-[24px] font-bold tracking-[-0.02em] text-ink">{title}</h1>
				<p className="text-sm text-muted-ink">{detail}</p>
				{stack && (
					<pre className="mt-4 text-left text-xs bg-paper rounded-xl p-4 overflow-x-auto text-ink-soft border border-line">
						{stack}
					</pre>
				)}
				<a
					href="/"
					className="inline-flex items-center h-10 mt-3 px-5 rounded-full bg-ink text-white text-[13px] font-semibold hover:bg-black transition-colors"
				>
					กลับหน้าหลัก
				</a>
			</div>
		</main>
	);
}
