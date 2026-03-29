import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
	plugins: [
		cloudflare({ viteEnvironment: { name: "ssr" } }),
		tailwindcss(),
		reactRouter(),
		tsconfigPaths(),
	],
	build: {
		rollupOptions: {
			onwarn(warning, warn) {
				if (
					warning.message?.includes(
						"Error when using sourcemap for reporting an error: Can't resolve original location of error."
					)
				) {
					return;
				}
				if (warning.message?.includes("Generated an empty chunk:")) {
					return;
				}
				warn(warning);
			},
		},
	},
});
