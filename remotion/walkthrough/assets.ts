// Every raster the walkthrough shows, as paths under public/ for
// remotion's staticFile(). All of them are borrowed from imagery that already
// lived in the repository: the brand exploration board committed at the root
// (cropped into tiles with sharp), and the two dashboard screenshots attached
// to decisions D004 and D066. test/walkthrough-slides.test.ts checks each one
// exists on disk so a renamed file cannot ship as a broken image.
export const WALKTHROUGH_ASSETS = Object.freeze({
  board: "walkthrough/brand-board.webp",
  landing: "walkthrough/landing.png",
  dashboard: "walkthrough/dashboard.png",
  appIconLight: "walkthrough/brand-app-icon-light.png",
  appIconDark: "walkthrough/brand-app-icon-dark.png",
  markSimple: "walkthrough/brand-mark-simple.png",
  markCircle: "walkthrough/brand-mark-circle.png",
  markCircleDark: "walkthrough/brand-mark-circle-dark.png",
  pLetter: "walkthrough/brand-p-letter.png",
  wordmark: "walkthrough/brand-wordmark.png",
  wordmarkTagline: "walkthrough/brand-wordmark-tagline.png",
  loading: "walkthrough/brand-loading.png",
  logoHorizontal: "walkthrough/brand-logo-horizontal.png",
});

/** Natural pixel sizes of the screenshots, needed to scroll them correctly. */
export const SCREENSHOT_SIZES = Object.freeze({
  landing: { width: 1440, height: 1807 },
  dashboard: { width: 1280, height: 2173 },
});
