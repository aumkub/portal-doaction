import {
	isRouteErrorResponse,
	Links,
	Meta,
	Outlet,
	Scripts,
	ScrollRestoration,
	useLoaderData,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
import { getAuthenticatedUser } from "~/lib/auth.server";
import { getLanguageFromCookieHeader, I18nProvider, resolveLanguage } from "~/lib/i18n";
export async function loader({ request, context }: Route.LoaderArgs) {
	const env = context.cloudflare.env;
	const cookieLang = getLanguageFromCookieHeader(request.headers.get("Cookie"));
	if (cookieLang) return { lang: cookieLang };

	const user = await getAuthenticatedUser(request, env.DB, env.SESSIONPORTAL);
	if (user?.language) return { lang: resolveLanguage(user.language) };

	return { lang: "th" as const };
}

export const links: Route.LinksFunction = () => [
	{ rel: "preconnect", href: "https://fonts.googleapis.com" },
	{
		rel: "preconnect",
		href: "https://fonts.gstatic.com",
		crossOrigin: "anonymous",
	},
	{
		rel: "stylesheet",
		href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
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
	return (
		<I18nProvider initialLang={lang}>
			<Outlet />
		</I18nProvider>
	);
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
	let status = 500;
	let title = "เกิดข้อผิดพลาด";
	let detail = "เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง";
	let stack: string | undefined;

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

	return (
		<main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
			<div className="bg-white rounded-2xl border border-slate-200 p-10 max-w-md w-full text-center space-y-4">
				<p className="text-5xl font-bold text-slate-200">{status}</p>
				<h1 className="text-xl font-semibold text-slate-900">{title}</h1>
				<p className="text-sm text-slate-500">{detail}</p>
				{stack && (
					<pre className="mt-4 text-left text-xs bg-slate-50 rounded-lg p-4 overflow-x-auto text-slate-600 border border-slate-100">
						{stack}
					</pre>
				)}
				<a
					href="/"
					className="inline-block mt-2 px-5 py-2.5 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 transition-colors"
				>
					กลับหน้าหลัก
				</a>
			</div>
		</main>
	);
}
