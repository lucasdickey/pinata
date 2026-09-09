// The two standard capture devices (VAL-CAPTURE-003).
//
// Geometry comes from the published catalog; the emulation profile around it
// (mobile user agent, touch, mobile viewport behaviour) lives here because it
// is how the device is produced, not a limit the contract measures. Desktop
// keeps the provider's own headless Chrome user agent: overriding it would
// claim a browser identity the session does not actually have.

import { DESKTOP_VIEWPORT, MOBILE_VIEWPORT } from "../../boundaries";
import type { CaptureVariant } from "../db/schema";

export interface DeviceViewport {
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
}

export interface DeviceProfile {
  variant: CaptureVariant;
  viewport: DeviceViewport;
  /** Null means "keep the session's own user agent". */
  userAgent: string | null;
}

/** Current mobile Safari on iPhone, the device the published mobile viewport
 * describes. */
const MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

export const DEVICE_PROFILES: Readonly<Record<CaptureVariant, DeviceProfile>> = Object.freeze({
  desktop: {
    variant: "desktop",
    viewport: { ...DESKTOP_VIEWPORT, isMobile: false, hasTouch: false },
    userAgent: null,
  },
  mobile: {
    variant: "mobile",
    viewport: { ...MOBILE_VIEWPORT, isMobile: true, hasTouch: true },
    userAgent: MOBILE_USER_AGENT,
  },
});

export function deviceProfile(variant: string): DeviceProfile | null {
  return variant === "desktop" || variant === "mobile" ? DEVICE_PROFILES[variant] : null;
}
