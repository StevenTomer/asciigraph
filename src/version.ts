/** Which asciigraph this is: the package version, the commit it was built from and the day it
 * was built (set by vite.config.ts), for the help dialog. */
declare const __APP_VERSION__: string | undefined;
export const VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "(development)";
