/** Full-page navigations away from the app (#586): to Google's consent
 * screen, which only a real browser round trip can reach. An object, not
 * a bare function, so tests can spy on it — jsdom implements no
 * navigation. */
export const browserNavigation = {
  assign(url: string): void {
    window.location.assign(url);
  },
};
