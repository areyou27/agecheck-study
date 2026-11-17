// Shared by playwright.config.js and the end-to-end tests.
// The tokens below exist only for the throwaway test server on RESEARCH_PORT.

export const PREVIEW_PORT = 4173;
export const RESEARCH_PORT = 4174;
export const RESEARCH_URL = `http://127.0.0.1:${RESEARCH_PORT}`;
export const TEST_SUBMIT_TOKEN = "e2e-only-submit-token-0123456789";
export const TEST_ADMIN_TOKEN = "e2e-only-admin-token-0123456789";
