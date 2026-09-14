"use client";

// The Desktop / Mobile toggle above the canvas (D077). A page's two captures
// used to be two entries in the rail; now the rail lists pages, and this
// pair of pressed buttons picks the device inside the canvas view. Each
// button keeps the accessible name the rail entries had ("Desktop capture of
// <page>") so the device is always named with its page, and shows the
// device's capture state beside the label so a failed sibling is visible
// without switching to it.

import type { DeviceView } from "./project-workspace";
import { STATE_LABELS, variantLabel } from "./capture-panel";

/** What the device shows for its state: the usable capture wins over a later failure. */
export function deviceStatus(device: DeviceView): string {
  if (device.usable && device.latest?.state !== "ready") {
    return `Ready (v${device.selectedAttempt}) · newest ${STATE_LABELS[
      device.latest?.state ?? "pending"
    ].toLowerCase()}`;
  }
  return device.latest ? STATE_LABELS[device.latest.state] : "Not captured";
}

export function DeviceToggle({
  pageUrl,
  devices,
  activeVariant,
  onChange,
}: {
  pageUrl: string;
  devices: readonly DeviceView[];
  activeVariant: string;
  onChange: (variant: string) => void;
}) {
  return (
    <p className="device-toggle" role="group" aria-label="Device" data-testid="device-toggle">
      {devices.map((device) => (
        <button
          key={device.variant}
          type="button"
          aria-pressed={device.variant === activeVariant}
          aria-label={`${variantLabel(device.variant)} capture of ${pageUrl}`}
          onClick={() => onChange(device.variant)}
        >
          {variantLabel(device.variant)}
          <span className="device-status"> — {deviceStatus(device)}</span>
        </button>
      ))}
    </p>
  );
}
