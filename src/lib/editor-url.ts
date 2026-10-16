export interface EditorAddress {
  project: string;
  page?: string;
  device?: "desktop" | "mobile";
  capture?: string;
  note?: string;
}

export function projectEditorUrl(address: EditorAddress): string {
  const query = new URLSearchParams({ project: address.project });
  if (address.page && address.device) {
    query.set("page", address.page);
    query.set("device", address.device);
    if (address.capture) query.set("capture", address.capture);
    if (address.note) query.set("note", address.note);
  }
  return `/pins?${query.toString()}`;
}

export function parseEditorAddress(search: string): EditorAddress | null {
  const query = new URLSearchParams(search);
  const project = query.get("project");
  if (!project) return null;
  const page = query.get("page");
  const device = query.get("device");
  if (!page || (device !== "desktop" && device !== "mobile")) {
    return { project };
  }
  return {
    project,
    page,
    device,
    ...(query.get("capture") ? { capture: query.get("capture")! } : {}),
    ...(query.get("note") ? { note: query.get("note")! } : {}),
  };
}
