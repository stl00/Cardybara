// Banks this build can connect. Source, tests and the alpha leave it null: every active bank.
// The release builder (scripts/build-release.py), the dev extension builder and Vite write it from release.json's
// "banks" (scripts/build-scope.mjs), so the beta package offers only those. Other banks stay in the code, hidden.
export const BUILD_BANKS=null;
